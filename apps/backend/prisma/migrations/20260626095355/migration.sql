/*
  Warnings:

  - You are about to drop the column `githubMetadat` on the `Interview` table. All the data in the column will be lost.
  - Added the required column `githubMetadata` to the `Interview` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Interview" DROP COLUMN "githubMetadat",
ADD COLUMN     "githubMetadata" JSONB NOT NULL;
