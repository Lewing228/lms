export type MissionType = "lesson" | "quiz" | "mentor" | "exam";

export type MissionContentBlockType = "text" | "video" | "pdf" | "quiz";

export type MissionQuiz = {
  question: string;
  options: string[];
  answer: number;
  explanation: string;
};

export type MissionContentBlock =
  | {
      id: string;
      type: "text";
      title: string;
      body: string;
      bullets?: string[];
    }
  | {
      id: string;
      type: "video";
      title: string;
      description: string;
      duration: string;
      url: string;
    }
  | {
      id: string;
      type: "pdf";
      title: string;
      sourceLabel: string;
      fileUrl?: string;
      pages?: {
        title: string;
        body?: string;
        imageUrl?: string;
        bullets?: string[];
      }[];
    }
  | {
      id: string;
      type: "quiz";
      title: string;
      passScore?: number;
      quiz: MissionQuiz;
    };

export type MissionContentDraft = {
  title: string;
  subtitle: string;
  duration: string;
  xp: number;
  stars: number;
  passScore?: number;
  source: string;
  goals: string[];
  contentBlocks: MissionContentBlock[];
  quiz?: MissionQuiz;
};

export type Mission = {
  id: string;
  order: number;
  title: string;
  subtitle: string;
  type: MissionType;
  duration: string;
  xp: number;
  stars: number;
  passScore?: number;
  source: string;
  goals: string[];
  lessonCards: {
    title: string;
    body: string;
  }[];
  contentBlocks?: MissionContentBlock[];
  quiz?: MissionQuiz;
  achievementId?: string;
  requiresMentor?: boolean;
};

export type Achievement = {
  id: string;
  title: string;
  description: string;
  tone: "green" | "gold" | "coral" | "blue" | "ink";
};

export type Reward = {
  id: string;
  title: string;
  description: string;
  cost: number;
  category: "Мерч" | "Смена" | "Еда" | "Развитие";
};

export type DailyControl = {
  id: string;
  title: string;
  description: string;
  targetScore: number;
};

export type BonusRule = {
  action: string;
  reward: string;
  type: "xp" | "stars" | "rating" | "privilege";
};

export type PenaltyRule = {
  reason: string;
  penalty: string;
};

export type AdmissionRequirement = {
  id: string;
  title: string;
  description: string;
};

export type MentorSkill = {
  id: string;
  title: string;
  description: string;
};

export type TraineeSummary = {
  id: string;
  name: string;
  role: string;
  status: string;
  progressLabel: string;
  mentor: string;
};

export type ShiftJournalStatus = "pending" | "approved" | "repeat";

export type ShiftJournalEntry = {
  id: string;
  day: string;
  title: string;
  focus: string;
  missionId: string;
};

export type PracticalExamItem = {
  id: string;
  title: string;
  description: string;
};

export type TrainingState = {
  completedMissionIds: string[];
  xp: number;
  stars: number;
  unlockedAchievementIds: string[];
  reservedRewardIds: string[];
  mentorApprovedMissionIds: string[];
  mentorScores: Record<string, number>;
  mentorComment: string;
  shiftEntryStatuses: Record<string, ShiftJournalStatus>;
  shiftEntryComments: Record<string, string>;
  practicalExamChecks: Record<string, boolean>;
  missionBlockOrders: Record<string, MissionContentBlockType[]>;
  missionContentDrafts: Record<string, MissionContentDraft>;
  finalApproved: boolean;
};
