-- AlterTable
ALTER TABLE "Scene" ADD COLUMN     "correctionAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "errorMessage" TEXT;

-- AlterTable
ALTER TABLE "Storyboard" ADD COLUMN     "errorMessage" TEXT;
