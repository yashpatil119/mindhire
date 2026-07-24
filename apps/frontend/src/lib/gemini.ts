import { GoogleGenAI, Modality, Session } from "@google/genai";
import type { LiveConnectParameters, LiveServerMessage } from "@google/genai";
import { BACKEND_URL } from '@/lib/config';

type RuntimeEnv = Record<string, string | undefined>;

export type GeminiLiveConnectParameters = Omit<LiveConnectParameters, "model">;

type RuntimeGlobal = typeof globalThis & {
    __MINDHIRE_GEMINI_ENV__?: RuntimeEnv;
};

function readRuntimeEnv(): RuntimeEnv {
    const metaEnv = typeof import.meta !== "undefined" && "env" in import.meta
        ? (import.meta as ImportMeta & { env?: RuntimeEnv }).env
        : undefined;

    const globalEnv = (globalThis as RuntimeGlobal).__MINDHIRE_GEMINI_ENV__;

    return {
        ...(globalEnv ?? {}),
        ...(metaEnv ?? {}),
    };
}

const runtimeEnv = readRuntimeEnv();
const apiKey =
    runtimeEnv.BUN_PUBLIC_GEMINI_API_KEY ??
    runtimeEnv.VITE_GEMINI_API_KEY ??
    runtimeEnv.GEMINI_API_KEY ??
    "";
const model =
    runtimeEnv.BUN_PUBLIC_GEMINI_MODEL ??
    runtimeEnv.VITE_GEMINI_MODEL ??
    "gemini-2.0-flash-live-001";

export interface GeminiCallbacks {
    onOpen?: () => void;
    onMessage?: (message: LiveServerMessage) => void;
    onError?: (error: unknown) => void;
    onClose?: () => void;
}

export class GeminiLiveClient {
    private session: Session | null = null;
    private sessionOpen = false;
    private audioActive = false;

    private async fetchEphemeralToken() {
        const response = await fetch(`${BACKEND_URL}/api/v1/gemini-token`);
        if (!response.ok) {
            const body = await response.text();
            throw new Error(`Failed to fetch Gemini token: ${response.status} ${response.statusText} ${body}`);
        }

        const data = await response.json();
        const token = data?.token;

        if (!token || typeof token !== "string") {
            throw new Error("Invalid Gemini token response from backend.");
        }

        return token;
    }

    async connect(params: GeminiLiveConnectParameters) {
        if (this.session) {
            try {
                this.session.close();
            } catch (error) {
                console.warn("Failed to close existing Gemini session", error);
            }
            this.session = null;
            this.sessionOpen = false;
        }

        const token = await this.fetchEphemeralToken();
        const ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: "v1alpha" } });

        const origCallbacks = params.callbacks ?? {};

        const wrappedCallbacks = {
            onopen: () => {
                this.sessionOpen = true;
                console.debug("Gemini: connection opened (wrapped)");
                try {
                    origCallbacks.onopen?.();
                } catch (err) {
                    console.warn("Error in user onopen callback", err);
                }
            },
            onmessage: (msg: LiveServerMessage) => {
                // pass through
                try {
                    origCallbacks.onmessage?.(msg as any);
                } catch (err) {
                    console.warn("Error in user onmessage callback", err);
                }
            },
            onerror: (err: unknown) => {
                console.debug("Gemini: connection error (wrapped)", err);
                try {
                    origCallbacks.onerror?.(err as any);
                } catch (e) {
                    console.warn("Error in user onerror callback", e);
                }
            },
            onclose: (ev: CloseEvent) => {
                this.sessionOpen = false;
                this.audioActive = false;
                console.debug("Gemini: connection closed (wrapped)");
                try {
                    origCallbacks.onclose?.(ev as any);
                } catch (e) {
                    console.warn("Error in user onclose callback", e);
                }
            },
        } as typeof params.callbacks;

        this.session = await ai.live.connect({
            ...params,
            model,
            config: {
                ...params.config,
                responseModalities: params.config?.responseModalities ?? [Modality.AUDIO],
                systemInstruction: `
You are MindHire AI Interviewer.
You conduct professional technical interviews.
Never break character.
Ask one question at a time.
Wait for the candidate response.
Do not explain answers.
Do not answer interview questions.
After every answer ask the next question.
Be friendly and professional.
                `,
            },
            callbacks: wrappedCallbacks,
        });

        return this.session;
    }

    private isSessionOpen() {
        if (!this.session || !this.sessionOpen) {
            return false;
        }

        const conn = (this.session as any).conn;
        const readyState = conn?.readyState;
        if (typeof readyState === "number") {
            return readyState === WebSocket.OPEN;
        }

        return true;
    }

    sendText(text: string) {
        if (!this.isSessionOpen()) {
            console.warn("Gemini session is not open. Dropping text message.");
            return;
        }
        if (!this.session) {
            return;
        }

        console.debug("Gemini: sending text", text);

        this.session.sendClientContent({
            turns: [
                {
                    role: "user",
                    parts: [{ text }],
                },
            ],
            turnComplete: true,
        });
    }

    sendAudio(blob: Blob) {
        if (!this.isSessionOpen()) {
            console.warn("Gemini session is not open. Dropping audio chunk.");
            return;
        }

        const reader = new FileReader();
        reader.onload = () => {
            if (!this.isSessionOpen()) {
                console.warn("Gemini session closed before audio chunk could be sent.");
                return;
            }
            if (!this.session) {
                return;
            }

            // send activityStart once before first audio chunk to help detection
            if (!this.audioActive) {
                try {
                    this.session.sendRealtimeInput({ activityStart: {} as any });
                } catch (err) {
                    console.warn("Failed to send activityStart", err);
                }
                this.audioActive = true;
            }

            const base64Data = (reader.result as string).split(",")[1] ?? "";
            try {
                this.session.sendRealtimeInput({
                    audio: {
                        data: base64Data,
                        mimeType: blob.type || "audio/webm",
                    },
                });
                console.debug("Gemini: sent audio chunk, bytes=", base64Data.length);
            } catch (err) {
                console.error("Failed to send realtime audio", err);
            }
        };
        reader.onerror = (event) => {
            console.error("Failed to read audio chunk", event);
        };
        reader.readAsDataURL(blob);
    }

    endAudioStream() {
        if (!this.isSessionOpen() || !this.session) {
            return;
        }

        try {
            this.session.sendRealtimeInput({
                activityEnd: {} as any,
                audioStreamEnd: true,
            });
            console.debug("Gemini: sent activityEnd and audioStreamEnd");
        } catch (err) {
            console.warn("Failed to send audioStreamEnd", err);
        }

        this.audioActive = false;
    }

    disconnect() {
        this.sessionOpen = false;
        try {
            if (this.audioActive && this.session) {
                this.session.sendRealtimeInput({
                    activityEnd: {} as any,
                    audioStreamEnd: true,
                });
            }
        } catch (err) {
            console.warn("Failed to send audioStreamEnd during disconnect", err);
        }
        this.audioActive = false;
        try {
            this.session?.close();
        } catch (err) {
            console.warn("Failed to close session", err);
        }
        this.session = null;
    }

    getSession() {
        return this.session;
    }
}

export const gemini = new GeminiLiveClient();