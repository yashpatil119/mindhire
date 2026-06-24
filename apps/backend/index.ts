import express from "express";
import { PreInterviewBody } from "./types";
import axios from "axios";
import cors from "cors"

const app = express();
app.use(express.json());
app.use(cors())

app.post('/api/v1/pre-interview', async( req,res) => {
      const {success,data} = PreInterviewBody.safeParse(req.body);

      if(!success){
        res.status(411).json({
            message : "Incorrect body"
        })
        return
      }
      
      const githubUrl = data.github.endsWith("/") ? data.github.slice(0,-1) : data.github;
      const githubUsername = githubUrl.split("/").pop();
     
      const userRepo = await axios.get(`https://api.github.com/users/${githubUsername}/repos`,
        {
          headers : {
            Authorization : `Bearer ${process.env.GITHUB_TOKEN}`,
            Accept: "application/vnd.github+json"
          }
        }
      )
      const filteredRepos = userRepo.data
       .map((repo: any) => ({
        name: repo.name,
        description: repo.description,
        stars: repo.stargazers_count,
        language: repo.language,
        url: repo.html_url
         }))
       .sort((a: any, b: any) => b.stars - a.stars)
       .slice(0, 5);

      console.log(filteredRepos)
      res.json({github : filteredRepos})
})
app.listen(3001);