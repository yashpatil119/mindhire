import React, { useState } from 'react'
import '../../styles/globals.css'
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import {toast, Toaster } from "sonner"
import axios from 'axios';
import { BACKEND_URL } from '@/lib/config';

function Form() {
    const [github,setGithub] = useState("")

   async function onsubmit(){
         if(!github){
            toast("Please provide Valid Github & LinkedIn URLS")
            return;
         }
         
       await axios.post(`${BACKEND_URL}/api/v1/pre-interview`,{
            github
         })
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
           <Button onClick={onsubmit}>Start Interview</Button>
        </div>
        <Toaster position='bottom-left'/>
     </div>   
    </div>
  )
}

export default Form