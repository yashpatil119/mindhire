import z from "zod";

export const PreInterviewBody = z.object({
    linkedIn : z.string(),
    github : z.string()
})