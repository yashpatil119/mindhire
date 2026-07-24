import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { gemini } from "@/lib/gemini";
import { LiveServerMessage, Modality } from "@google/genai";

type Status = "connecting" | "live" | "ending";

type ConversationTurn = {
    role: "assistant" | "candidate";
    text: string;
};

function speakText(text: string) {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
        return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = 1;
    window.speechSynthesis.speak(utterance);
}

function base64ToUint8Array(base64: string) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

function playAudioBase64(base64: string, mimeType: string) {
    const bytes = base64ToUint8Array(base64);
    const blob = new Blob([bytes], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);

    audio.play().catch((error) => {
        console.error("Audio playback failed", error);
    }).finally(() => {
        URL.revokeObjectURL(url);
    });
}

function extractTextFromMessage(message: LiveServerMessage) {
    return (
        message.text?.trim() ||
        message.serverContent?.modelTurn?.parts
            ?.map((part) => part.text?.trim())
            .filter(Boolean)
            .join(" ") ||
        ""
    );
}

function extractCandidateText(message: LiveServerMessage) {
    return (
        message.serverContent?.inputTranscription?.text?.trim() ||
        message.serverContent?.interimInputTranscription?.text?.trim() ||
        ""
    );
}

function findAudioPart(message: LiveServerMessage) {
    return message.serverContent?.modelTurn?.parts?.find(
        (part) => part.inlineData?.data && part.inlineData.mimeType?.startsWith("audio/")
    );
}

function Interview() {
    const { interviewId } = useParams();
    const navigate = useNavigate();

    const [status, setStatus] = useState<Status>("connecting");
    const [assistantText, setAssistantText] = useState("");
    const [candidateText, setCandidateText] = useState("The candidate has not spoken yet.");
    const [conversation, setConversation] = useState<ConversationTurn[]>([]);
    const [errorMessage, setErrorMessage] = useState("");

    const recorderRef = useRef<MediaRecorder | null>(null);
    const streamRef = useRef<MediaStream | null>(null);

    const cleanup = () => {
        recorderRef.current?.state !== "inactive" && recorderRef.current?.stop();
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        gemini.disconnect();
        window.speechSynthesis?.cancel();
    };

    useEffect(() => {
        let cancelled = false;

        const startConversation = async () => {
            if (!interviewId) {
                return;
            }

            try {
                if (!navigator.mediaDevices?.getUserMedia) {
                    throw new Error("This browser does not support microphone access.");
                }

                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                if (cancelled) {
                    stream.getTracks().forEach((track) => track.stop());
                    return;
                }

                streamRef.current = stream;

                const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
                    ? "audio/webm;codecs=opus"
                    : undefined;

                const recorder = mimeType
                    ? new MediaRecorder(stream, { mimeType })
                    : new MediaRecorder(stream);

                recorderRef.current = recorder;

                recorder.ondataavailable = (event) => {
                    if (event.data.size > 0) {
                        setCandidateText("Listening to your response...");
                        gemini.sendAudio(event.data);
                    }
                };

                recorder.onerror = (event) => {
                    console.error("MediaRecorder error", event);
                };

                recorder.onstop = () => {
                    if (candidateText === "Listening to your response...") {
                        setCandidateText("Microphone input stopped.");
                    }
                    // signal end of audio stream to Gemini so it can finalize
                    try {
                        gemini.endAudioStream();
                    } catch (err) {
                        console.warn("Failed to end audio stream", err);
                    }
                };

                await gemini.connect({
                    config: {
                        responseModalities: [Modality.TEXT, Modality.AUDIO],
                    },
                    callbacks: {
                        onopen: () => {
                            if (cancelled) {
                                return;
                            }

                            setStatus("live");
                            setErrorMessage("");
                            setCandidateText("The candidate can respond when the interviewer finishes speaking.");

                            if (recorderRef.current && recorderRef.current.state === "inactive") {
                                recorderRef.current.start(1000);
                            }

                            gemini.sendText(
                                "Welcome! I am MindHire AI Interviewer. Greet the candidate warmly and ask the first interview question."
                            );
                        },
                        onmessage: (message: LiveServerMessage) => {
                            console.debug("Gemini onmessage", message);
                            const nextText = extractTextFromMessage(message);
                            const candidateTranscript = extractCandidateText(message);
                            const audioPart = findAudioPart(message);
                            const candidateFinished = message.serverContent?.inputTranscription?.finished ?? false;

                            if (candidateTranscript) {
                                if (candidateFinished) {
                                    setCandidateText(candidateTranscript);
                                    setConversation((prev) => [
                                        ...prev.filter((turn) => turn.text !== "Candidate is speaking..."),
                                        { role: "candidate", text: candidateTranscript },
                                    ]);
                                } else {
                                    setCandidateText(`Candidate is speaking: ${candidateTranscript}`);
                                }
                            }

                            if (nextText) {
                                setAssistantText(nextText);
                                setConversation((prev) => [...prev, { role: "assistant", text: nextText }]);
                                setCandidateText("Candidate can respond after this question.");
                                speakText(nextText);
                            } else if (audioPart) {
                                setAssistantText("[Audio response]");
                                setConversation((prev) => [...prev, { role: "assistant", text: "[Audio response]" }]);
                            }

                            if (audioPart && audioPart.inlineData?.data && audioPart.inlineData.mimeType) {
                                playAudioBase64(audioPart.inlineData.data, audioPart.inlineData.mimeType);
                            }
                        },
                        
                        onerror: (error: unknown) => {
                            console.error("Gemini error", error);
                            if (!cancelled) {
                                const message = error instanceof Error ? error.message : "Unable to connect to Gemini.";
                                setErrorMessage(message);
                                toast.error(message);
                            }
                        },
                        onclose: () => {
                            if (!cancelled) {
                                setStatus("ending");
                            }

                            if (recorderRef.current && recorderRef.current.state !== "inactive") {
                                recorderRef.current.stop();
                            }
                        },
                    },
                });
            } catch (error) {
                if (!cancelled) {
                    const message = error instanceof Error ? error.message : "Unable to start the interview.";
                    setErrorMessage(message);
                    setStatus("ending");
                    toast.error(message);
                }
            }
        };

        startConversation();

        return () => {
            cancelled = true;
            cleanup();
        };
    }, [interviewId]);

    function endInterview() {
        setStatus("ending");
        cleanup();
        navigate(`/result/${interviewId}`);
    }

    return (
        <div className="min-h-screen bg-slate-950 px-4 py-10 text-slate-50">
            <div className="mx-auto flex max-w-4xl flex-col gap-6 rounded-2xl border border-slate-800 bg-slate-900/80 p-6 shadow-2xl shadow-black/40">
                <div className="flex items-center justify-between gap-4">
                    <div>
                        <p className="text-sm uppercase tracking-[0.3em] text-sky-400">Voice Interview</p>
                        <h1 className="mt-2 text-2xl font-semibold">MindHire AI Interviewer</h1>
                    </div>
                    <button
                        onClick={endInterview}
                        className="rounded-full border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-medium transition hover:bg-slate-700"
                    >
                        End Interview
                    </button>
                </div>

                <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5">
                    <div className="flex flex-col gap-4 md:flex-row">
                        <div className="flex-1 rounded-3xl border border-slate-800 bg-slate-900 p-5 shadow-sm shadow-black/20">
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <p className="text-sm uppercase tracking-[0.3em] text-sky-400">Interviewer</p>
                                    <p className="mt-2 text-xs text-slate-500">AI voice interviewer</p>
                                </div>
                                <span className={`h-3 w-3 rounded-full ${status === "live" ? "bg-emerald-500" : status === "connecting" ? "bg-amber-500" : "bg-rose-500"}`} />
                            </div>

                            <div className="mt-4 rounded-3xl border border-slate-800 bg-slate-950 p-4">
                                <p className="text-sm font-medium text-slate-300">{assistantText || "The interviewer will begin speaking here as soon as the connection is ready."}</p>
                            </div>
                        </div>

                        <div className="flex-1 rounded-3xl border border-slate-800 bg-slate-900 p-5 shadow-sm shadow-black/20">
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <p className="text-sm uppercase tracking-[0.3em] text-emerald-400">Candidate</p>
                                    <p className="mt-2 text-xs text-slate-500">Your live response status</p>
                                </div>
                                <span className="h-3 w-3 rounded-full bg-slate-500" />
                            </div>

                            <div className="mt-4 rounded-3xl border border-slate-800 bg-slate-950 p-4">
                                <p className="text-sm font-medium text-slate-300">{candidateText}</p>
                            </div>
                        </div>
                    </div>

                    <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900 p-4">
                        <p className="text-sm text-slate-400">Conversation</p>
                        <div className="mt-3 flex flex-col gap-3">
                            {conversation.length === 0 ? (
                                <p className="text-sm text-slate-500">Your live conversation will appear here.</p>
                            ) : (
                                conversation.map((turn, index) => (
                                    <div
                                        key={`${turn.role}-${index}`}
                                        className={`rounded-2xl p-4 text-sm ${turn.role === "assistant" ? "bg-slate-950/90 text-slate-100 border border-slate-800" : "bg-slate-900/90 text-slate-200 border border-slate-700 self-end"}`}
                                    >
                                        <p className="mb-1 text-[0.65rem] uppercase tracking-[0.25em] text-slate-500">{turn.role === "assistant" ? "Interviewer" : "Candidate"}</p>
                                        <p>{turn.text}</p>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    {errorMessage ? (
                        <div className="mt-4 rounded-lg border border-rose-800 bg-rose-950/60 p-3 text-sm text-rose-300">
                            {errorMessage}
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    );
}

export default Interview;