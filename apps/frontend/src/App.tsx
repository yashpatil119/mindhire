import { useState } from 'react';
import Form from './components/Form'
import Interview from './components/Interview';
import Result from './components/Result';
import { BrowserRouter,Route,Routes } from 'react-router-dom';
import { Toaster } from 'sonner';


export function App() {
  return (
   <BrowserRouter>
     <Routes>
        <Route path='/' element={<Form/>}/>
        <Route path='/interview/:id' element={<Interview/>}/>
        <Route path='/result/:id' element={<Result/>}/> 
     </Routes>
   </BrowserRouter>
  ); 
}

export default App;
