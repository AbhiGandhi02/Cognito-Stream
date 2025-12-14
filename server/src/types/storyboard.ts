export type Scene = {
  id: string;
  title: string;
  narration: string;
  visuals: string;
  manimCode: string;
  durationMs?: number;
  audioUrl?: string;
  status: 'draft' | 'tts_pending' | 'rendered';
};

export type StoryboardPayload = {
  prompt: string;
  title: string;
  synopsis: string;
  scenes: Scene[];
};

export type Storyboard = StoryboardPayload & {
  id: string;
  status: 'DRAFT' | 'TTS_PENDING' | 'RENDERING' | 'COMPLETE' | 'ERROR';
  videoUrl?: string;
  createdAt: Date;
  updatedAt: Date;
};

