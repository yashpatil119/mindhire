import React, { useState } from 'react'
import '../../styles/globals.css'
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import {toast, Toaster } from "sonner"
import axios from 'axios';
import { BACKEND_URL } from '@/lib/config';
import { Navigate, useNavigate } from 'react-router-dom';

function Form() {
    const [github, setGithub] = useState("");
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();

    async function requestMicrophonePermission() {
        if (!navigator.mediaDevices?.getUserMedia) {
            throw new Error("This browser does not support microphone access.");
        }

        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
    }

    async function onsubmit() {
        const trimmedGithub = github.trim();
        if (!trimmedGithub) {
            toast("Please provide a valid GitHub URL");
            return;
        }

        setLoading(true);

        try {
            await requestMicrophonePermission();

            const response = await axios.post(`${BACKEND_URL}/api/v1/pre-interview`, {
                github: trimmedGithub,
            });

            navigate(`/interview/${response.data.id}`);
        } catch (error) {
            const message = axios.isAxiosError(error)
                ? error.response?.data?.message || error.message
                : error instanceof Error
                    ? error.message
                    : "Unable to start the interview right now.";
            toast.error(message);
        } finally {
            setLoading(false);
        }
    }

  return (
  <div className="h-screen w-screen flex justify-center items-center ">
      <div className=''>
          <h2 className="scroll-m-20 border-b pb-2 text-3xl font-semibold tracking-tight first:mt-0">
            Kickstart Your Ai Interview
          </h2>
        <div className='p-4 mb-2'>
          <Input placeholder='GithubURL' onChange={e => setGithub(e.target.value)} /> 
        </div>
        <div className='flex justify-center p-3'>
           <Button type='button' disabled={loading} onClick={onsubmit}>
             {loading ? "Starting Interview..." : "Start Interview"}
           </Button>
        </div>
        <Toaster position='bottom-left'/>
     </div>   
    </div>
  )
}

export default Form;