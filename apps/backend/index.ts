import dotenv from "dotenv";
import express from "express";
import { PreInterviewBody } from "./types";
import axios from "axios";
import cors from "cors";
import { GoogleGenAI, Modality } from "@google/genai";
import { prisma } from "./db";

dotenv.config();

const app = express();
app.use(express.text({ type: ["application/sdp", "text/plain"] }));
app.use(express.json());
app.use(cors({
   origin : "http://localhost:3000",
   credentials: true
}))

app.post('/api/v1/pre-interview', async( req,res) => {
    console.log("Request received");
      const {success,data} = PreInterviewBody.safeParse(req.body);

      if(!success){
        res.status(411).json({
            message : "Incorrect body"
        })
        return
      }

      const githubUrl = data.github.trim().replace(/\/+$/, "");
      const githubUsername = githubUrl.split("/").filter(Boolean).pop();

      if(!githubUsername){
        res.status(400).json({ message: "Please provide a valid GitHub URL" });
        return;
      }

      let filteredRepos: any[] = [];

      try {
        const userRepo = await axios.get(`https://api.github.com/users/${githubUsername}/repos`,
          {
            headers : {
              Authorization : process.env.GITHUB_TOKEN ? `Bearer ${process.env.GITHUB_TOKEN}` : undefined,
              Accept: "application/vnd.github+json"
            }
          }
        )
        filteredRepos = userRepo.data
          .map((repo: any) => ({
            name: repo.name,
            description: repo.description,
            stars: repo.stargazers_count,
            language: repo.language,
            url: repo.html_url
          }))
          .sort((a: any, b: any) => b.stars - a.stars)
          .slice(0, 5);
      } catch (error) {
        console.warn("GitHub metadata fetch failed, continuing with empty metadata", error);
      }

      let interviewId = `temp-${Date.now()}`;

      try {
        const interview = await prisma.interview.create({
          data : {
            githubMetadata : JSON.stringify(filteredRepos),
            status : "Pre"
          }
        })
        interviewId = interview.id;
      } catch (error) {
        console.warn("Database interview record creation failed, using fallback ID", error);
      }

      console.log(filteredRepos)
      res.json({id : interviewId})
})

const geminiApiKey = process.env.GEMINI_API_KEY ?? "";
const geminiClient = new GoogleGenAI({ apiKey: geminiApiKey, httpOptions: { apiVersion: "v1alpha" } });

app.get('/api/v1/gemini-token', async (req, res) => {
    if (!geminiApiKey) {
        res.status(500).json({ message: "Gemini API key not configured on the backend." });
        return;
    }

    try {
        const expiresInMinutes = 20;
        const expireTime = new Date(Date.now() + expiresInMinutes * 60 * 1000).toISOString();

        const token = await geminiClient.authTokens.create({
            config: {
                expireTime,
                uses: 1,
                liveConnectConstraints: {
                    model: "gemini-2.0-flash-live-001",
                    config: {
                        responseModalities: [Modality.AUDIO, Modality.TEXT],
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
                },
                lockAdditionalFields: ["responseModalities", "systemInstruction"],
            },
        });

        res.json({ token: token.name });
    } catch (error) {
        console.error("Gemini auth token creation failed", error);
        res.status(500).json({ message: "Failed to create Gemini auth token." });
    }
});

app.post('/api/v1/session/:interviewId',async(req,res)=>{
   const sessionConfig = JSON.stringify({
        type: "realtime",
        model: "gpt-realtime",
        audio: { output: { voice: "marin" } },
    });

    const fd = new FormData();
    fd.set("sdp", req.body);
    fd.set("session", sessionConfig);
  
    try {
      const sdpResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_KEY}`,
          "OpenAI-Safety-Identifier": "hashed-user-id",
        },
        body: fd,
      });

      const location = sdpResponse.headers.get("Location");
      const callId = location?.split("/").pop()!;
      console.log(callId);
      // Send back the SDP we received from the OpenAI REST API
      const sdp = await sdpResponse.text();
      res.send(sdp);
    }
    catch(error){
          console.error("token generation erorr",error);
          res.status(500).json({error:"failed to generate token"});
    }
    

});

app.listen( 3001,()=> {
  console.log("backend is running on Port 3001")
});