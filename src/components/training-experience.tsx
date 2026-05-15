"use client";

import {
  ArrowDown,
  ArrowUp,
  Award,
  BadgeCheck,
  BookOpenCheck,
  Check,
  ChevronRight,
  ClipboardCheck,
  CopyPlus,
  Gift,
  GraduationCap,
  Lock,
  Medal,
  FileText,
  PlayCircle,
  RotateCcw,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Star,
  Trash2,
  Trophy,
  UserCheck,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, ElementType, SetStateAction } from "react";
import { assetPath } from "@/lib/assets";
import {
  achievements,
  admissionRequirements,
  bonusRules,
  dailyControls,
  defaultTrainingState,
  developmentGoals,
  employeeLevels,
  kpiMetrics,
  leaderboardEntries,
  mentorSkills,
  missions,
  penaltyRules,
  practicalExamItems,
  rewards,
  shiftJournal,
} from "@/lib/training-data";
import type { Achievement, Mission, MissionContentBlock, MissionContentBlockType, MissionContentDraft, MissionQuiz, ShiftJournalStatus, TrainingState } from "@/types/training";

type ViewName = "map" | "achievements" | "shop" | "mentor" | "admin";
type MissionStatus = "done" | "current" | "locked";

const storageKey = "waiter-training-state-v1";
const defaultBlockOrder: MissionContentBlockType[] = ["text", "video", "pdf", "quiz"];
const welcomeBookPdfUrl = assetPath("/training/pdfs/welcome-book.pdf");
const welcomeVideoUrl = assetPath("/training/videos/welcome.mp4");
const serviceIntroVideoUrl = assetPath("/training/service-intro.mp4");
const pdfWorkerUrl = assetPath("/pdf.worker.min.mjs");

const pdfMinZoom = 50;
const pdfMaxZoom = 600;
const pdfZoomStep = 25;

const viewItems: { id: ViewName; label: string; icon: ElementType }[] = [
  { id: "map", label: "Карта", icon: Trophy },
  { id: "achievements", label: "Награды", icon: Medal },
  { id: "shop", label: "Магазин", icon: ShoppingBag },
  { id: "mentor", label: "Наставник", icon: ClipboardCheck },
  { id: "admin", label: "Профиль", icon: ShieldCheck },
];

function cloneDefaultState(): TrainingState {
  return JSON.parse(JSON.stringify(defaultTrainingState)) as TrainingState;
}

function clampPdfZoom(value: number) {
  const rounded = Math.round(value / 5) * 5;
  return Math.max(pdfMinZoom, Math.min(pdfMaxZoom, rounded));
}

function getTouchDistance(touches: TouchList) {
  const first = touches[0];
  const second = touches[1];
  return Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
}

function normalizeSavedMissionDrafts(drafts: TrainingState["missionContentDrafts"]) {
  const welcomeDraft = drafts.welcome;
  if (!welcomeDraft?.contentBlocks) return drafts;

  return {
    ...drafts,
    welcome: {
      ...welcomeDraft,
      contentBlocks: welcomeDraft.contentBlocks.map((block) => {
        if (block.type !== "pdf" || block.id !== "welcome-book-pdf") return block;

        return {
          ...block,
          fileUrl: welcomeBookPdfUrl,
          pages: undefined,
        };
      }),
    },
  };
}

function readState(): TrainingState {
  if (typeof window === "undefined") return cloneDefaultState();

  const saved = window.localStorage.getItem(storageKey);
  if (!saved) return cloneDefaultState();

  try {
    const defaults = cloneDefaultState();
    const parsed = JSON.parse(saved) as Partial<TrainingState>;
    const missionContentDrafts = normalizeSavedMissionDrafts({
      ...defaults.missionContentDrafts,
      ...parsed.missionContentDrafts,
    });

    return {
      ...defaults,
      ...parsed,
      mentorScores: {
        ...defaults.mentorScores,
        ...parsed.mentorScores,
      },
      shiftEntryStatuses: {
        ...defaults.shiftEntryStatuses,
        ...parsed.shiftEntryStatuses,
      },
      shiftEntryComments: {
        ...defaults.shiftEntryComments,
        ...parsed.shiftEntryComments,
      },
      practicalExamChecks: {
        ...defaults.practicalExamChecks,
        ...parsed.practicalExamChecks,
      },
      missionBlockOrders: {
        ...defaults.missionBlockOrders,
        ...parsed.missionBlockOrders,
      },
      missionContentDrafts,
    } as TrainingState;
  } catch {
    return cloneDefaultState();
  }
}

function getMissionStatus(state: TrainingState, mission: Mission): MissionStatus {
  if (state.completedMissionIds.includes(mission.id)) return "done";
  if (mission.order === state.completedMissionIds.length + 1) return "current";
  return "locked";
}

function getRole(state: TrainingState) {
  if (state.finalApproved || state.completedMissionIds.includes("final-exam")) return "Официант";
  if (state.completedMissionIds.length >= 5) return "Помощник официанта";
  return "Стажер";
}

function getCurrentLevel(state: TrainingState) {
  return employeeLevels.reduce((currentLevel, level) => (state.xp >= level.requiredXp ? level : currentLevel), employeeLevels[0]);
}

function getNextLevel(state: TrainingState) {
  const currentLevel = getCurrentLevel(state);
  return employeeLevels.find((level) => level.level > currentLevel.level);
}

function getLevelProgress(state: TrainingState) {
  const currentLevel = getCurrentLevel(state);
  const nextLevel = getNextLevel(state);
  if (!nextLevel) return 100;

  const earnedInLevel = state.xp - currentLevel.requiredXp;
  const neededForLevel = nextLevel.requiredXp - currentLevel.requiredXp;
  return Math.max(0, Math.min(100, Math.round((earnedInLevel / neededForLevel) * 100)));
}

function getCleanStreak(state: TrainingState) {
  const repeatCount = Object.values(state.shiftEntryStatuses).filter((status) => status === "repeat").length;
  return Math.max(0, Math.min(7, state.completedMissionIds.length + state.mentorApprovedMissionIds.length - repeatCount));
}

function getPersonalRating(state: TrainingState, mentorAverage: string) {
  const completionPart = Math.round((state.completedMissionIds.length / missions.length) * 34);
  const mentorPart = Math.round((Number(mentorAverage) / 5) * 26);
  const achievementPart = Math.round((state.unlockedAchievementIds.length / achievements.length) * 18);
  const streakPart = Math.round((getCleanStreak(state) / 7) * 12);
  const penalty = Object.values(state.shiftEntryStatuses).filter((status) => status === "repeat").length * 6;
  return Math.max(0, Math.min(100, 10 + completionPart + mentorPart + achievementPart + streakPart - penalty));
}

function getPenaltyRisk(state: TrainingState) {
  const repeatCount = Object.values(state.shiftEntryStatuses).filter((status) => status === "repeat").length;
  const lowScores = Object.values(state.mentorScores).filter((score) => score < 4).length;
  if (repeatCount > 0 || lowScores >= 3) return "Высокий";
  if (lowScores > 0) return "Средний";
  return "Низкий";
}

function applyMissionDraft(mission: Mission, state: TrainingState): Mission {
  const draft = state.missionContentDrafts[mission.id];
  if (!draft) return mission;

  return {
    ...mission,
    title: draft.title,
    subtitle: draft.subtitle,
    duration: draft.duration,
    xp: draft.xp,
    stars: draft.stars,
    passScore: draft.passScore,
    source: draft.source,
    goals: draft.goals,
    contentBlocks: draft.contentBlocks,
    quiz: draft.quiz,
  };
}

function toneClass(tone: Achievement["tone"]) {
  const tones = {
    green: "bg-emerald-100 text-emerald-700 ring-emerald-200",
    gold: "bg-amber-100 text-amber-700 ring-amber-200",
    coral: "bg-rose-100 text-rose-700 ring-rose-200",
    blue: "bg-blue-100 text-blue-700 ring-blue-200",
    ink: "bg-slate-100 text-slate-800 ring-slate-200",
  };
  return tones[tone];
}

export function TrainingExperience() {
  const [state, setState] = useState<TrainingState>(() => cloneDefaultState());
  const [isHydrated, setIsHydrated] = useState(false);
  const [activeView, setActiveView] = useState<ViewName>("map");
  const [activeMission, setActiveMission] = useState<Mission | null>(null);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setState(readState());
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (isHydrated) window.localStorage.setItem(storageKey, JSON.stringify(state));
  }, [isHydrated, state]);

  const visibleMissions = useMemo(() => missions.map((mission) => applyMissionDraft(mission, state)), [state]);
  const progress = Math.round((state.completedMissionIds.length / visibleMissions.length) * 100);
  const currentMission = visibleMissions.find((mission) => getMissionStatus(state, mission) === "current") ?? visibleMissions.at(-1)!;
  const role = getRole(state);

  const showMessage = (text: string) => {
    setMessage(text);
    window.setTimeout(() => setMessage(null), 2600);
  };

  const unlockAchievement = (achievementId: string, draft: TrainingState) => {
    if (!draft.unlockedAchievementIds.includes(achievementId)) {
      draft.unlockedAchievementIds.push(achievementId);
    }
  };

  const completeMission = () => {
    if (!activeMission) return;
    const status = getMissionStatus(state, activeMission);

    if (status === "done") {
      setActiveMission(null);
      return;
    }

    if (status === "locked") {
      showMessage("Эта миссия пока закрыта");
      return;
    }

    if (activeMission.quiz && selectedAnswer === null) {
      showMessage("Сначала выбери ответ");
      return;
    }

    if (activeMission.quiz && selectedAnswer !== activeMission.quiz.answer) {
      showMessage("Ответ неверный. Попробуй еще раз");
      return;
    }

    if (activeMission.requiresMentor && !state.mentorApprovedMissionIds.includes(activeMission.id)) {
      setActiveView("mentor");
      setActiveMission(null);
      showMessage("Нужна оценка наставника");
      return;
    }

    setState((previous) => {
      const draft: TrainingState = {
        ...previous,
        completedMissionIds: [...previous.completedMissionIds, activeMission.id],
        xp: previous.xp + activeMission.xp,
        stars: previous.stars + activeMission.stars,
        unlockedAchievementIds: [...previous.unlockedAchievementIds],
        finalApproved: activeMission.id === "final-exam" ? true : previous.finalApproved,
      };

      if (activeMission.achievementId) unlockAchievement(activeMission.achievementId, draft);
      if (activeMission.quiz) unlockAchievement("perfect-test", draft);
      if (activeMission.id === "final-exam") unlockAchievement("waiter", draft);

      return draft;
    });

    setActiveMission(null);
    setSelectedAnswer(null);
    showMessage(`Миссия закрыта: +${activeMission.xp} XP, +${activeMission.stars} звезд`);
  };

  const approvePractice = (missionId: string) => {
    setState((previous) => {
      const alreadyApproved = previous.mentorApprovedMissionIds.includes(missionId);
      const journalEntry = shiftJournal.find((entry) => entry.missionId === missionId);
      const draft: TrainingState = {
        ...previous,
        stars: alreadyApproved ? previous.stars : previous.stars + 2,
        mentorApprovedMissionIds: alreadyApproved
          ? previous.mentorApprovedMissionIds
          : [...previous.mentorApprovedMissionIds, missionId],
        shiftEntryStatuses:
          journalEntry && !alreadyApproved
            ? {
                ...previous.shiftEntryStatuses,
                [journalEntry.id]: "approved",
              }
            : previous.shiftEntryStatuses,
        unlockedAchievementIds: [...previous.unlockedAchievementIds],
      };

      unlockAchievement("team-player", draft);
      if (missionId === "tray-practice") unlockAchievement("floor-ready", draft);
      return draft;
    });
    showMessage("Наставник подтвердил практику: +2 звезды");
  };

  const updateMentorScore = (skillId: string, score: number) => {
    setState((previous) => ({
      ...previous,
      mentorScores: {
        ...previous.mentorScores,
        [skillId]: score,
      },
    }));
  };

  const updateMentorComment = (comment: string) => {
    setState((previous) => ({
      ...previous,
      mentorComment: comment,
    }));
  };

  const updateShiftStatus = (entryId: string, status: ShiftJournalStatus) => {
    setState((previous) => ({
      ...previous,
      shiftEntryStatuses: {
        ...previous.shiftEntryStatuses,
        [entryId]: status,
      },
    }));
  };

  const updateShiftComment = (entryId: string, comment: string) => {
    setState((previous) => ({
      ...previous,
      shiftEntryComments: {
        ...previous.shiftEntryComments,
        [entryId]: comment,
      },
    }));
  };

  const togglePracticalExamItem = (itemId: string) => {
    setState((previous) => ({
      ...previous,
      practicalExamChecks: {
        ...previous.practicalExamChecks,
        [itemId]: !previous.practicalExamChecks[itemId],
      },
    }));
  };

  const updateMissionBlockOrder = (missionId: string, order: MissionContentBlockType[]) => {
    setState((previous) => ({
      ...previous,
      missionBlockOrders: {
        ...previous.missionBlockOrders,
        [missionId]: order,
      },
    }));
  };

  const updateMissionContentDraft = (missionId: string, draft: MissionContentDraft) => {
    setState((previous) => ({
      ...previous,
      missionContentDrafts: {
        ...previous.missionContentDrafts,
        [missionId]: draft,
      },
    }));
  };

  const resetMissionContentDraft = (missionId: string) => {
    setState((previous) => {
      const { [missionId]: _removedDraft, ...missionContentDrafts } = previous.missionContentDrafts;
      const { [missionId]: _removedOrder, ...missionBlockOrders } = previous.missionBlockOrders;

      return {
        ...previous,
        missionContentDrafts,
        missionBlockOrders,
      };
    });
    showMessage("Контент задания сброшен");
  };

  const reserveReward = (rewardId: string) => {
    const reward = rewards.find((item) => item.id === rewardId);
    if (!reward) return;
    if (state.reservedRewardIds.includes(rewardId)) return;
    if (state.stars < reward.cost) {
      showMessage("Пока не хватает звезд");
      return;
    }

    setState((previous) => ({
      ...previous,
      stars: previous.stars - reward.cost,
      reservedRewardIds: [...previous.reservedRewardIds, rewardId],
    }));
    showMessage(`${reward.title}: заявка отправлена`);
  };

  const resetProgress = () => {
    setState(cloneDefaultState());
    setSelectedAnswer(null);
    setActiveMission(null);
    showMessage("Прогресс сброшен");
  };

  const mentorAverage = useMemo(() => {
    const scores = Object.values(state.mentorScores);
    return scores.length ? (scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(1) : "0";
  }, [state.mentorScores]);

  return (
    <main className="min-h-screen bg-[#fbf7f2] pb-24 text-[#372820]">
      <header className="sticky top-0 z-30 border-b border-[#eadfd4] bg-[#fbf7f2]/95 px-4 py-4 backdrop-blur-xl">
        <div className="mx-auto w-full max-w-6xl">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="truncate text-xl font-black tracking-tight sm:text-2xl">От стажера к официанту</h1>
              <p className="mt-1 text-sm font-medium text-[#8b7b70]">Проходи уровни и открывай новые навыки</p>
            </div>
            <div className="flex flex-none items-center gap-2">
              <div className="rounded-2xl border border-[#eee3d9] bg-white px-3 py-2 text-sm font-black shadow-sm">
                ✨ {state.xp} XP
              </div>
              <button
                type="button"
                onClick={resetProgress}
                className="grid h-10 w-10 place-items-center rounded-2xl border border-[#eee3d9] bg-white shadow-sm"
                aria-label="Сбросить прогресс"
                title="Сбросить прогресс"
              >
                <RotateCcw size={17} />
              </button>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#e8ded6]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#e3654f] to-[#f5b45b]"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="w-10 text-right text-sm font-black">{progress}%</span>
          </div>
          <div className="mt-2 flex items-center justify-between text-xs font-bold text-[#9a897d]">
            <span>{role}</span>
            <span>{state.completedMissionIds.length}/{visibleMissions.length} пройдено</span>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-6xl px-4">
        {activeView === "map" && (
          <div className="animate-in">
            <MapView state={state} missionList={visibleMissions} onOpenMission={setActiveMission} />
          </div>
        )}
        {activeView === "achievements" && (
          <div className="animate-in py-5">
            <AchievementsView state={state} />
          </div>
        )}
        {activeView === "shop" && (
          <div className="animate-in py-5">
            <ShopView state={state} onReserve={reserveReward} />
          </div>
        )}
        {activeView === "mentor" && (
          <div className="animate-in py-5">
            <MentorView
              state={state}
              mentorAverage={mentorAverage}
              onApprovePractice={approvePractice}
              onUpdateScore={updateMentorScore}
              onUpdateComment={updateMentorComment}
              onUpdateShiftStatus={updateShiftStatus}
              onUpdateShiftComment={updateShiftComment}
              onTogglePracticalExamItem={togglePracticalExamItem}
            />
          </div>
        )}
        {activeView === "admin" && (
          <div className="animate-in py-5">
            <AdminView
              state={state}
              progress={progress}
              mentorAverage={mentorAverage}
              currentMission={currentMission}
              missionList={visibleMissions}
              onUpdateMissionBlockOrder={updateMissionBlockOrder}
              onUpdateMissionContentDraft={updateMissionContentDraft}
              onResetMissionContentDraft={resetMissionContentDraft}
            />
          </div>
        )}
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-[#eadfd4] bg-white/95 px-3 py-2 shadow-[0_-8px_30px_rgba(55,40,32,0.08)] backdrop-blur-xl">
        <div className="mx-auto grid max-w-xl grid-cols-5 gap-1">
          {viewItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeView === item.id;
            return (
              <button
                type="button"
                key={item.id}
                onClick={() => setActiveView(item.id)}
                className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-2xl text-[11px] font-black transition ${
                  isActive ? "bg-[#fff0ea] text-[#e3654f]" : "text-[#8b7b70]"
                }`}
              >
                <Icon size={20} />
                {item.label}
              </button>
            );
          })}
        </div>
      </nav>

      {activeMission && (
        <MissionModal
          mission={applyMissionDraft(activeMission, state)}
          status={getMissionStatus(state, activeMission)}
          blockOrder={state.missionBlockOrders[activeMission.id]}
          selectedAnswer={selectedAnswer}
          isMentorApproved={state.mentorApprovedMissionIds.includes(activeMission.id)}
          onClose={() => {
            setActiveMission(null);
            setSelectedAnswer(null);
          }}
          onSelectAnswer={setSelectedAnswer}
          onComplete={completeMission}
        />
      )}

      {message && (
        <div className="animate-toast fixed bottom-5 left-1/2 z-50 max-w-[calc(100vw-32px)] -translate-x-1/2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-bold text-white shadow-soft">
          {message}
        </div>
      )}
    </main>
  );
}

function StatPill({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl bg-white/10 p-3">
      <p className="text-lg font-black leading-none">{value}</p>
      <p className="mt-1 text-[11px] text-white/55">{label}</p>
    </div>
  );
}

function CurrentTaskCard({
  currentMission,
  progress,
  onOpenMission,
}: {
  currentMission: Mission;
  progress: number;
  onOpenMission: (mission: Mission) => void;
}) {
  return (
    <article className="rounded-[30px] border border-black/5 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase text-emerald-700">Сегодня</p>
          <h2 className="mt-1 text-xl font-black tracking-tight">{currentMission.title}</h2>
          <p className="mt-1 text-sm font-bold text-slate-500">{currentMission.subtitle}</p>
        </div>
        <div className="grid h-12 w-12 flex-none place-items-center rounded-2xl bg-emerald-100 text-emerald-700">
          <MissionIcon mission={currentMission} />
        </div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        <InfoPill label="прогресс" value={`${progress}%`} />
        <InfoPill label="награда" value={`+${currentMission.stars} ★`} />
        <InfoPill label="время" value={currentMission.duration} />
      </div>
      <button
        type="button"
        onClick={() => onOpenMission(currentMission)}
        className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 text-sm font-black text-white"
      >
        Продолжить
        <ChevronRight size={18} />
      </button>
    </article>
  );
}

function ProgressPanel({
  state,
  currentMission,
  mentorAverage,
}: {
  state: TrainingState;
  currentMission: Mission;
  mentorAverage: string;
}) {
  const nextReward = rewards.find((reward) => !state.reservedRewardIds.includes(reward.id));
  const completed = state.completedMissionIds.length;

  return (
    <div className="sticky top-28 grid gap-4">
      <article className="rounded-[28px] border border-black/5 bg-white p-5 shadow-sm">
        <p className="text-xs font-black uppercase text-emerald-700">Текущий этап</p>
        <h3 className="mt-2 text-2xl font-black tracking-tight">{currentMission.title}</h3>
        <p className="mt-2 text-sm leading-6 text-slate-500">Учебный модуль: {currentMission.subtitle}</p>
        <div className="mt-4 grid gap-2">
          {currentMission.goals.slice(0, 3).map((goal) => (
            <div key={goal} className="flex items-start gap-2 rounded-2xl bg-slate-50 p-3 text-sm font-bold text-slate-600">
              <Check className="mt-0.5 flex-none text-emerald-600" size={16} />
              {goal}
            </div>
          ))}
        </div>
      </article>

      <article className="rounded-[28px] border border-black/5 bg-white p-5 shadow-sm">
        <p className="text-xs font-black uppercase text-slate-400">Сводка</p>
        <div className="mt-4 grid gap-3">
          <AdminMetric label="Миссии" value={`${completed}/${missions.length}`} hint="Закрыто по учебной карте" />
          <AdminMetric label="Оценка наставника" value={mentorAverage} hint="Средний балл чек-листа" />
          <AdminMetric label="Бейджи" value={`${state.unlockedAchievementIds.length}/${achievements.length}`} hint="Открытые достижения" />
        </div>
      </article>

      {nextReward && (
        <article className="rounded-[28px] bg-slate-950 p-5 text-white shadow-sm">
          <p className="text-xs font-black uppercase text-white/50">Ближайшая награда</p>
          <h3 className="mt-2 text-xl font-black">{nextReward.title}</h3>
          <p className="mt-2 text-sm leading-6 text-white/60">{nextReward.description}</p>
          <div className="mt-4 rounded-2xl bg-white/10 px-4 py-3 text-sm font-black">{nextReward.cost} звезд</div>
        </article>
      )}
    </div>
  );
}

function MapView({
  state,
  missionList,
  onOpenMission,
}: {
  state: TrainingState;
  missionList: Mission[];
  onOpenMission: (mission: Mission) => void;
}) {
  const points = getQuestMapPoints(missionList.length);
  const mapHeight = points.at(-1)!.y + 210;
  const questPath = getQuestPath(points);

  return (
    <section className="pt-5">
      <div className="relative mx-auto w-full max-w-[390px]" style={{ height: mapHeight }}>
        <div className="absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded-full border border-emerald-200 bg-emerald-100 px-5 py-2 text-sm font-black text-emerald-700">
          Старт
        </div>
        <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 390 ${mapHeight}`} preserveAspectRatio="none" aria-hidden="true">
          <path
            d={questPath}
            fill="none"
            stroke="#ead2b6"
            strokeWidth="13"
            strokeLinecap="round"
          />
          <path
            d={questPath}
            fill="none"
            stroke="#c8a984"
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray="1 16"
            opacity="0.8"
          />
        </svg>

        {missionList.map((mission, index) => {
          const status = getMissionStatus(state, mission);
          const point = points[index];
          return (
            <button
              type="button"
              key={mission.id}
              className="absolute z-10 w-[132px] -translate-x-1/2 -translate-y-1/2 text-center transition active:scale-95"
              style={{ left: `${(point.x / 390) * 100}%`, top: point.y }}
              onClick={() => status !== "locked" && onOpenMission(mission)}
              disabled={status === "locked"}
            >
              <span
                className={`mx-auto grid h-[58px] w-[58px] place-items-center rounded-[18px] border-[4px] border-white shadow-lg ${
                  status === "done"
                    ? "bg-emerald-500 text-white"
                    : status === "current"
                      ? "bg-sky-500 text-white ring-[8px] ring-orange-100"
                      : "bg-[#f4eee8] text-[#aa9b8f]"
                }`}
              >
                {status === "done" ? (
                  <Check size={24} strokeWidth={4} />
                ) : status === "locked" ? (
                  <Lock size={20} />
                ) : (
                  <MissionIcon mission={mission} />
                )}
              </span>
              <span className="mt-2 flex justify-center gap-0.5">
                {[0, 1, 2].map((star) => (
                  <Star
                    key={star}
                    size={12}
                    className={
                      status === "locked"
                        ? "fill-transparent text-[#d9cec3]"
                        : star < Math.max(1, Math.min(3, mission.stars || 1))
                          ? "fill-amber-400 text-amber-400"
                          : "fill-transparent text-[#d9cec3]"
                    }
                  />
                ))}
              </span>
              <strong className={`mt-1 block text-[12px] leading-tight ${status === "locked" ? "text-[#9c8f83]" : "text-[#372820]"}`}>
                {mission.title}
              </strong>
              <span className="mt-0.5 block text-[11px] font-medium text-[#a99688]">{missionStage(mission)}</span>
            </button>
          );
        })}
        <div className="absolute bottom-10 left-1/2 z-10 -translate-x-1/2 text-center text-lg font-black text-[#372820]">
          Официант
        </div>
      </div>
    </section>
  );
}

function getQuestMapPoints(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    x: index % 2 === 0 ? 142 : 248,
    y: 132 + index * 154,
  }));
}

function getQuestPath(points: { x: number; y: number }[]) {
  if (!points.length) return "";
  const [first] = points;
  return points.slice(1).reduce((path, point, index) => {
    const previous = points[index];
    const midY = (previous.y + point.y) / 2;
    return `${path} C ${previous.x} ${midY}, ${point.x} ${midY}, ${point.x} ${point.y}`;
  }, `M 196 70 C ${first.x} 88, ${first.x} 104, ${first.x} ${first.y}`);
}

function missionStage(mission: Mission) {
  if (mission.order <= 5) return "Адаптация";
  if (mission.order <= 10) return "Сервис";
  if (mission.order <= 15) return "Меню";
  if (mission.order <= 18) return "Стажировка";
  if (mission.order === 19) return "Продажи";
  return "Экзамен";
}

function MissionIcon({ mission }: { mission: Mission }) {
  if (mission.type === "quiz") return <BookOpenCheck size={22} />;
  if (mission.type === "mentor") return <UserCheck size={22} />;
  if (mission.type === "exam") return <GraduationCap size={24} />;
  return <Sparkles size={22} />;
}

function AchievementsView({ state }: { state: TrainingState }) {
  return (
    <section>
      <SectionTitle eyebrow="Коллекция" title="Достижения" action={`${state.unlockedAchievementIds.length}/${achievements.length}`} />
      <div className="mt-4 grid grid-cols-2 gap-3">
        {achievements.map((achievement) => {
          const unlocked = state.unlockedAchievementIds.includes(achievement.id);
          return (
            <article
              key={achievement.id}
              className={`min-h-36 rounded-[24px] border p-4 shadow-sm ${
                unlocked ? "border-black/5 bg-white" : "border-black/5 bg-white/50 text-slate-400"
              }`}
            >
              <div
                className={`mb-4 grid h-12 w-12 place-items-center rounded-2xl ring-1 ${unlocked ? toneClass(achievement.tone) : "bg-slate-100 text-slate-400 ring-slate-200"}`}
              >
                {unlocked ? <Award size={22} /> : <Lock size={18} />}
              </div>
              <h3 className="text-sm font-black">{achievement.title}</h3>
              <p className="mt-1 text-xs leading-5 text-slate-500">{achievement.description}</p>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ShopView({ state, onReserve }: { state: TrainingState; onReserve: (rewardId: string) => void }) {
  return (
    <section>
      <SectionTitle eyebrow="Звездочки" title="Магазин плюшек" action={`${state.stars} звезд`} />
      <div className="mt-4 grid gap-3">
        {rewards.map((reward) => {
          const reserved = state.reservedRewardIds.includes(reward.id);
          const canBuy = state.stars >= reward.cost && !reserved;
          return (
            <article key={reward.id} className="grid grid-cols-[52px_1fr_auto] items-center gap-3 rounded-[24px] border border-black/5 bg-white p-3 shadow-sm">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-amber-100 text-amber-700">
                <Gift size={22} />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="truncate text-sm font-black">{reward.title}</h3>
                  <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-black text-slate-500">{reward.category}</span>
                </div>
                <p className="mt-1 text-xs leading-5 text-slate-500">{reward.description}</p>
              </div>
              <button
                type="button"
                onClick={() => onReserve(reward.id)}
                disabled={!canBuy}
                className={`rounded-2xl px-3 py-2 text-xs font-black ${
                  canBuy ? "bg-slate-950 text-white" : reserved ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400"
                }`}
              >
                {reserved ? "Ждет" : `${reward.cost} ★`}
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function MentorView({
  state,
  mentorAverage,
  onApprovePractice,
  onUpdateScore,
  onUpdateComment,
  onUpdateShiftStatus,
  onUpdateShiftComment,
  onTogglePracticalExamItem,
}: {
  state: TrainingState;
  mentorAverage: string;
  onApprovePractice: (missionId: string) => void;
  onUpdateScore: (skillId: string, score: number) => void;
  onUpdateComment: (comment: string) => void;
  onUpdateShiftStatus: (entryId: string, status: ShiftJournalStatus) => void;
  onUpdateShiftComment: (entryId: string, comment: string) => void;
  onTogglePracticalExamItem: (itemId: string) => void;
}) {
  const practicalMissions = missions.filter((mission) => mission.requiresMentor);
  const currentMission = missions.find((mission) => getMissionStatus(state, mission) === "current") ?? missions.at(-1)!;
  const practicalExamReady = practicalExamItems.every((item) => state.practicalExamChecks[item.id]);
  const checkedExamItems = practicalExamItems.filter((item) => state.practicalExamChecks[item.id]).length;
  const weakestSkill = mentorSkills.reduce((lowest, skill) => {
    const currentScore = state.mentorScores[skill.id] ?? 0;
    const lowestScore = state.mentorScores[lowest.id] ?? 0;
    return currentScore < lowestScore ? skill : lowest;
  }, mentorSkills[0]);
  const statusOptions: { id: ShiftJournalStatus; label: string }[] = [
    { id: "pending", label: "на проверке" },
    { id: "approved", label: "принято" },
    { id: "repeat", label: "на повтор" },
  ];

  return (
    <section>
      <SectionTitle eyebrow="Наставник" title="Контроль стажера" action="Алина С." />

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <article className="rounded-[28px] border border-black/5 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase text-emerald-700">Стажер на проверке</p>
              <h3 className="font-black">Алина С.</h3>
            </div>
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-950 text-white">
              <UserCheck size={21} />
            </div>
          </div>
          <div className="mt-4 rounded-2xl bg-[#fff0ea] p-4 ring-1 ring-[#f2d3c7]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-black">{getRole(state)}</p>
                <p className="mt-1 text-xs font-bold text-slate-500">Путь: стажер - официант</p>
              </div>
              <span className="rounded-full bg-white px-3 py-1 text-[11px] font-black text-slate-600">
                {state.finalApproved ? "Допущена" : "В обучении"}
              </span>
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-white">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#e3654f] to-[#f5b45b]"
                style={{ width: `${Math.round((state.completedMissionIds.length / missions.length) * 100)}%` }}
              />
            </div>
            <div className="mt-3 flex items-center justify-between gap-3 text-xs font-bold text-slate-500">
              <span>{state.completedMissionIds.length}/{missions.length} миссий</span>
              <span>Наставник смены</span>
            </div>
          </div>
        </article>

        <article className="rounded-[28px] border border-black/5 bg-white p-4 shadow-sm">
          <p className="text-xs font-black uppercase text-emerald-700">Сводка по Алине</p>
          <h3 className="mt-1 font-black">Готовность к допуску</h3>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <InfoPill label="средний балл" value={mentorAverage} />
            <InfoPill label="текущая миссия" value={`#${currentMission.order}`} />
            <InfoPill label="практика" value={`${state.mentorApprovedMissionIds.length}/${practicalMissions.length}`} />
            <InfoPill label="экзамен" value={`${checkedExamItems}/${practicalExamItems.length}`} />
          </div>
          <div className="mt-4 rounded-2xl bg-amber-50 p-3">
            <p className="text-xs font-black uppercase text-amber-700">Рекомендация</p>
            <p className="mt-1 text-sm font-bold leading-6 text-slate-700">
              Усилить навык: {weakestSkill.title.toLowerCase()}. Добавить короткую тренировку перед следующей сменой.
            </p>
          </div>
        </article>
      </div>

      <article className="mt-4 rounded-[28px] border border-black/5 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-emerald-600 to-slate-900 font-black text-white">
            Н
          </div>
          <div>
            <h3 className="font-black">Оценки Алины за смену</h3>
            <p className="text-xs font-bold text-slate-500">Ежедневный контроль 1-5 после практики</p>
          </div>
        </div>

        <div className="mt-4 grid gap-3">
          {mentorSkills.map((skill) => (
            <div key={skill.id} className="rounded-2xl bg-slate-50 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h4 className="text-sm font-black">{skill.title}</h4>
                  <p className="mt-1 text-xs leading-5 text-slate-500">{skill.description}</p>
                </div>
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map((score) => (
                    <button
                      type="button"
                      key={score}
                      onClick={() => onUpdateScore(skill.id, score)}
                      className={`grid h-7 w-7 place-items-center rounded-full text-xs font-black ${
                        state.mentorScores[skill.id] === score ? "bg-amber-400 text-slate-950" : "bg-white text-slate-400"
                      }`}
                    >
                      {score}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </article>

      <article className="mt-4 rounded-[28px] border border-black/5 bg-white p-4 shadow-sm">
        <h3 className="font-black">Комментарий по Алине</h3>
        <p className="mt-1 text-xs font-bold text-slate-500">Короткая заметка попадает в профиль стажера и помогает принять решение по допуску.</p>
        <textarea
          value={state.mentorComment}
          onChange={(event) => onUpdateComment(event.target.value)}
          className="mt-4 min-h-28 w-full resize-none rounded-[22px] border border-black/5 bg-slate-50 p-4 text-sm font-bold leading-6 outline-none focus:border-emerald-300 focus:bg-white"
          placeholder="Например: уверенно встречает гостей, но нужно закрепить продажи и POS."
        />
      </article>

      <article className="mt-4 rounded-[28px] border border-black/5 bg-white p-4 shadow-sm">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase text-emerald-700">4-14 день</p>
            <h3 className="font-black">Журнал смен Алины</h3>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-2 text-xs font-black text-slate-600">
            {shiftJournal.length} записей
          </span>
        </div>
        <div className="mt-4 grid gap-3">
          {shiftJournal.map((entry) => {
            const status = state.shiftEntryStatuses[entry.id] ?? "pending";
            const missionDone = state.completedMissionIds.includes(entry.missionId);
            return (
              <div key={entry.id} className="rounded-2xl bg-slate-50 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase text-slate-400">{entry.day}</p>
                    <h4 className="mt-1 text-sm font-black">{entry.title}</h4>
                    <p className="mt-1 text-xs leading-5 text-slate-500">{entry.focus}</p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-[11px] font-black ${missionDone ? "bg-emerald-100 text-emerald-700" : "bg-white text-slate-500"}`}>
                    {missionDone ? "закрыто" : "в пути"}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-1">
                  {statusOptions.map((option) => (
                    <button
                      type="button"
                      key={option.id}
                      onClick={() => onUpdateShiftStatus(entry.id, option.id)}
                      className={`min-h-9 rounded-xl px-2 text-[11px] font-black ${
                        status === option.id ? journalStatusClass(option.id) : "bg-white text-slate-400"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <textarea
                  value={state.shiftEntryComments[entry.id] ?? ""}
                  onChange={(event) => onUpdateShiftComment(entry.id, event.target.value)}
                  className="mt-3 min-h-20 w-full resize-none rounded-2xl border border-black/5 bg-white p-3 text-xs font-bold leading-5 text-slate-600 outline-none focus:border-emerald-300"
                  placeholder="Комментарий по смене"
                />
              </div>
            );
          })}
        </div>
      </article>

      <article className="mt-4 rounded-[28px] border border-black/5 bg-white p-4 shadow-sm">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase text-emerald-700">14-21 день</p>
            <h3 className="font-black">Практический экзамен Алины</h3>
          </div>
          <span className={`rounded-full px-3 py-2 text-xs font-black ${practicalExamReady ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>
            {checkedExamItems}/{practicalExamItems.length}
          </span>
        </div>
        <div className="mt-4 grid gap-2">
          {practicalExamItems.map((item) => {
            const checked = state.practicalExamChecks[item.id];
            return (
              <button
                type="button"
                key={item.id}
                onClick={() => onTogglePracticalExamItem(item.id)}
                className={`flex items-start gap-3 rounded-2xl p-3 text-left ${
                  checked ? "bg-emerald-50 text-emerald-900" : "bg-slate-50 text-slate-700"
                }`}
              >
                <span
                  className={`mt-0.5 grid h-6 w-6 flex-none place-items-center rounded-full ${
                    checked ? "bg-emerald-500 text-white" : "bg-white text-slate-400"
                  }`}
                >
                  {checked ? <Check size={14} strokeWidth={4} /> : <ClipboardCheck size={13} />}
                </span>
                <span>
                  <span className="block text-sm font-black">{item.title}</span>
                  <span className="mt-1 block text-xs font-bold leading-5 text-slate-500">{item.description}</span>
                </span>
              </button>
            );
          })}
        </div>
      </article>

      <article className="mt-4 rounded-[28px] border border-black/5 bg-white p-4 shadow-sm">
        <h3 className="font-black">Подтверждение этапов Алины</h3>
        <p className="mt-1 text-xs font-bold text-slate-500">Кнопка открывается по мере прохождения карты. Для финала нужен полный практический чек-лист.</p>
        <div className="mt-4 grid gap-3">
          {practicalMissions.map((mission) => {
            const approved = state.mentorApprovedMissionIds.includes(mission.id);
            const previousDone = mission.order <= state.completedMissionIds.length + 1;
            const finalBlocked = mission.id === "final-exam" && !practicalExamReady;
            const canApprove = previousDone && !approved && !finalBlocked;
            return (
              <button
                type="button"
                key={mission.id}
                disabled={!canApprove}
                onClick={() => onApprovePractice(mission.id)}
                className={`flex min-h-14 items-center justify-between gap-3 rounded-2xl px-4 text-left font-black ${
                  approved ? "bg-emerald-100 text-emerald-800" : canApprove ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-400"
                }`}
              >
                <span>
                  {approved
                    ? "Подтверждено"
                    : finalBlocked
                      ? "Сначала закрыть чек-лист экзамена"
                      : `Подтвердить: ${mission.title}`}
                </span>
                {approved ? <BadgeCheck size={20} /> : <ChevronRight size={20} />}
              </button>
            );
          })}
        </div>
      </article>
    </section>
  );
}

function journalStatusClass(status: ShiftJournalStatus) {
  if (status === "approved") return "bg-emerald-100 text-emerald-700";
  if (status === "repeat") return "bg-rose-100 text-rose-700";
  return "bg-amber-100 text-amber-800";
}

function kpiStatusClass(status: "good" | "watch" | "locked") {
  if (status === "good") return "bg-emerald-100 text-emerald-700";
  if (status === "watch") return "bg-amber-100 text-amber-800";
  return "bg-slate-200 text-slate-500";
}

function AdminView({
  state,
  progress,
  mentorAverage,
  currentMission,
  missionList,
  onUpdateMissionBlockOrder,
  onUpdateMissionContentDraft,
  onResetMissionContentDraft,
}: {
  state: TrainingState;
  progress: number;
  mentorAverage: string;
  currentMission: Mission;
  missionList: Mission[];
  onUpdateMissionBlockOrder: (missionId: string, order: MissionContentBlockType[]) => void;
  onUpdateMissionContentDraft: (missionId: string, draft: MissionContentDraft) => void;
  onResetMissionContentDraft: (missionId: string) => void;
}) {
  const [selectedMissionId, setSelectedMissionId] = useState(currentMission.id);
  const completed = state.completedMissionIds.length;
  const currentLevel = getCurrentLevel(state);
  const nextLevel = getNextLevel(state);
  const levelProgress = getLevelProgress(state);
  const cleanStreak = getCleanStreak(state);
  const personalRating = getPersonalRating(state, mentorAverage);
  const penaltyRisk = getPenaltyRisk(state);
  const leaderboard = leaderboardEntries
    .map((entry) => (entry.id === "alina" ? { ...entry, role: getRole(state), rating: personalRating, xp: state.xp, badges: state.unlockedAchievementIds.length, streakDays: cleanStreak } : entry))
    .sort((left, right) => right.rating - left.rating);
  const alinaPlace = leaderboard.findIndex((entry) => entry.id === "alina") + 1;
  const selectedMission = missionList.find((mission) => mission.id === selectedMissionId) ?? currentMission;
  const theoryReady = completed >= 19;
  const basePracticeReady = ["day-one-check", "tray-practice", "service-checklist", "mentor-shift-one", "mentor-shift-two"].every((id) =>
    state.mentorApprovedMissionIds.includes(id),
  );
  const practicalExamReady = practicalExamItems.every((item) => state.practicalExamChecks[item.id]);
  const practiceReady = basePracticeReady && practicalExamReady;
  const noCriticalViolations = Number(mentorAverage) >= 4;
  const mentorRecommendation = state.mentorApprovedMissionIds.includes("final-exam") && practicalExamReady;
  const blockOrder = state.missionBlockOrders[selectedMission.id] ?? defaultBlockOrder;
  const draft = state.missionContentDrafts[selectedMission.id] ?? createMissionDraft(selectedMission, blockOrder);
  const draftMission = applyDraftToMission(selectedMission, draft);
  const orderedBlocks = draftMission.contentBlocks ?? getMissionContentBlocks(draftMission, blockOrder);
  const requirementStatus: Record<string, boolean> = {
    theory: theoryReady,
    practice: practiceReady,
    "clean-record": noCriticalViolations,
    mentor: mentorRecommendation,
  };
  const moveBlock = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= draft.contentBlocks.length) return;

    const nextBlocks = [...draft.contentBlocks];
    const [moved] = nextBlocks.splice(index, 1);
    nextBlocks.splice(nextIndex, 0, moved);
    saveDraft({ ...draft, contentBlocks: nextBlocks });
  };
  const saveDraft = (nextDraft: MissionContentDraft) => onUpdateMissionContentDraft(selectedMission.id, nextDraft);
  const updateDraft = (changes: Partial<MissionContentDraft>) => saveDraft({ ...draft, ...changes });
  const updateBlock = (blockId: string, updater: (block: MissionContentBlock) => MissionContentBlock) => {
    updateDraft({
      contentBlocks: draft.contentBlocks.map((block) => (block.id === blockId ? updater(block) : block)),
    });
  };
  const updateQuiz = (changes: Partial<MissionQuiz>) => {
    const currentQuiz = draft.quiz ?? {
      question: "",
      options: ["", "", ""],
      answer: 0,
      explanation: "",
    };

    updateDraft({
      quiz: {
        ...currentQuiz,
        ...changes,
      },
    });
  };
  const addBlock = (type: MissionContentBlockType) => {
    const id = `${selectedMission.id}-${type}-${Date.now()}`;
    const nextBlock: MissionContentBlock =
      type === "video"
        ? {
            id,
            type: "video",
            title: "Новое видео",
            description: "Описание видео",
            duration: "1 мин",
            url: welcomeVideoUrl,
          }
        : type === "pdf"
          ? {
              id,
              type: "pdf",
              title: "Новый PDF",
              sourceLabel: "PDF материал",
              pages: [{ title: "Страница 1", body: "Текст страницы", bullets: [] }],
            }
          : type === "quiz"
            ? {
                id,
                type: "quiz",
                title: "Новый тест",
                passScore: 85,
                quiz: {
                  question: "Вопрос",
                  options: ["Вариант 1", "Вариант 2", "Вариант 3"],
                  answer: 0,
                  explanation: "Объяснение ответа",
                },
              }
            : {
                id,
                type: "text",
                title: "Новый текст",
                body: "Текст блока",
                bullets: [],
              };

    saveDraft({ ...draft, contentBlocks: [...draft.contentBlocks, nextBlock] });
  };

  return (
    <section>
      <SectionTitle eyebrow="Профиль" title="Алина С." action={`${progress}%`} />
      <div className="mt-4 grid gap-3">
        <AdminMetric label="Текущий статус" value={getRole(state)} hint="Путь стажер - официант" />
        <AdminMetric label="Уровень" value={`${currentLevel.level}`} hint={currentLevel.status} />
        <AdminMetric label="Личный рейтинг" value={`${personalRating}`} hint={`Место #${alinaPlace} в ресторане`} />
        <AdminMetric label="Закрыто миссий" value={`${state.completedMissionIds.length}/${missionList.length}`} hint="По карте обучения" />
        <AdminMetric label="Средняя оценка наставника" value={mentorAverage} hint="Чек-лист практики" />
        <AdminMetric label="Звезды" value={`${state.stars}`} hint="Можно тратить в магазине наград" />
      </div>

      <article className="mt-4 overflow-hidden rounded-[28px] border border-black/5 bg-white shadow-sm">
        <div className="bg-slate-950 p-5 text-white">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase text-white/50">Уровень сотрудника</p>
              <h3 className="mt-1 text-2xl font-black">{currentLevel.status}</h3>
              <p className="mt-2 text-sm font-bold leading-6 text-white/60">{currentLevel.description}</p>
            </div>
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-white text-xl font-black text-slate-950">
              {currentLevel.level}
            </div>
          </div>
          <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/15">
            <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-amber-300" style={{ width: `${levelProgress}%` }} />
          </div>
          <div className="mt-3 flex items-center justify-between gap-3 text-xs font-black text-white/60">
            <span>{state.xp} XP</span>
            <span>{nextLevel ? `До "${nextLevel.status}" нужно ${Math.max(0, nextLevel.requiredXp - state.xp)} XP` : "Максимальный уровень"}</span>
          </div>
        </div>
        <div className="grid gap-2 p-4">
          {employeeLevels.slice(0, 4).map((level) => {
            const unlocked = state.xp >= level.requiredXp;
            const active = level.level === currentLevel.level;
            return (
              <div key={level.level} className={`flex items-center gap-3 rounded-2xl p-3 ${active ? "bg-emerald-50" : "bg-slate-50"}`}>
                <span className={`grid h-8 w-8 place-items-center rounded-xl text-xs font-black ${unlocked ? "bg-slate-950 text-white" : "bg-white text-slate-400"}`}>
                  {level.level}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-black">{level.status}</p>
                  <p className="text-xs font-bold text-slate-500">{level.requiredXp} XP</p>
                </div>
                {unlocked ? <BadgeCheck className="text-emerald-600" size={18} /> : <Lock className="text-slate-300" size={16} />}
              </div>
            );
          })}
        </div>
      </article>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <article className="rounded-[28px] border border-black/5 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase text-emerald-700">Рейтинг ресторана</p>
              <h3 className="font-black">Лидерборд</h3>
            </div>
            <span className="rounded-full bg-amber-100 px-3 py-2 text-xs font-black text-amber-800">#{alinaPlace}</span>
          </div>
          <div className="mt-4 grid gap-2">
            {leaderboard.slice(0, 5).map((entry, index) => (
              <div key={entry.id} className={`grid grid-cols-[32px_1fr_auto] items-center gap-3 rounded-2xl p-3 ${entry.id === "alina" ? "bg-emerald-50" : "bg-slate-50"}`}>
                <span className="grid h-8 w-8 place-items-center rounded-xl bg-white text-xs font-black text-slate-600">{index + 1}</span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-black">{entry.name}</p>
                  <p className="truncate text-xs font-bold text-slate-500">{entry.role} · {entry.badges} бейджей · {entry.streakDays} дней без опозданий</p>
                </div>
                <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-slate-700">{entry.rating}</span>
              </div>
            ))}
          </div>
        </article>

        <article className="rounded-[28px] border border-black/5 bg-white p-5 shadow-sm">
          <p className="text-xs font-black uppercase text-emerald-700">Мотивация</p>
          <h3 className="font-black">Цели и рекомендации</h3>
          <div className="mt-4 grid gap-2">
            {developmentGoals.map((goal) => {
              const done =
                goal.id === "no-late"
                  ? cleanStreak >= 7
                  : goal.id === "menu-test"
                    ? state.completedMissionIds.includes("menu-test")
                    : goal.id === "sales-practice"
                      ? state.completedMissionIds.includes("sales")
                      : practicalExamItems.every((item) => state.practicalExamChecks[item.id]);
              return (
                <div key={goal.id} className={`rounded-2xl p-3 ${done ? "bg-emerald-50" : "bg-slate-50"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-black">{goal.title}</p>
                      <p className="mt-1 text-xs font-bold leading-5 text-slate-500">{goal.description}</p>
                    </div>
                    <span className={`flex-none rounded-full px-3 py-1 text-[11px] font-black ${done ? "bg-emerald-100 text-emerald-700" : "bg-white text-slate-500"}`}>
                      {done ? "готово" : goal.target}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </article>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <article className="rounded-[28px] border border-black/5 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase text-emerald-700">KPI после допуска</p>
              <h3 className="font-black">Продажи и сервис</h3>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-2 text-xs font-black text-slate-600">этап 4</span>
          </div>
          <div className="mt-4 grid gap-2">
            {kpiMetrics.map((metric) => (
              <div key={metric.id} className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 p-3">
                <div>
                  <p className="text-sm font-black">{metric.title}</p>
                  <p className="mt-1 text-xs font-bold text-slate-500">{metric.current}</p>
                </div>
                <span className={`rounded-full px-3 py-1 text-[11px] font-black ${kpiStatusClass(metric.status)}`}>{metric.target}</span>
              </div>
            ))}
          </div>
        </article>

        <article className="rounded-[28px] border border-black/5 bg-white p-5 shadow-sm">
          <p className="text-xs font-black uppercase text-emerald-700">Штрафы и риск</p>
          <h3 className="font-black">Дисциплина профиля</h3>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <InfoPill label="серия без опозданий" value={`${cleanStreak}/7`} />
            <InfoPill label="риск штрафов" value={penaltyRisk} />
          </div>
          <div className="mt-4 rounded-2xl bg-rose-50 p-3">
            <p className="text-xs font-black uppercase text-rose-700">Что влияет</p>
            <p className="mt-1 text-sm font-bold leading-6 text-slate-700">
              Опоздания, нарушения формы, жалобы, провал тестов и повторные смены снижают рейтинг и могут заблокировать допуск.
            </p>
          </div>
        </article>
      </div>

      <article className="mt-4 rounded-[28px] border border-black/5 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase text-emerald-700">Админ контента</p>
            <h3 className="font-black">Редактор задания</h3>
            <p className="mt-1 text-xs font-bold leading-5 text-slate-500">
              Здесь меняется весь материал: карточка, блоки, PDF-страницы, видео и тест.
            </p>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-2 text-xs font-black text-slate-600">
            {selectedMission.order} миссия
          </span>
        </div>

        <div className="mt-4 grid gap-3">
          <label className="grid gap-2">
            <span className="text-xs font-black uppercase text-slate-400">Какое задание редактируем</span>
            <select
              value={selectedMissionId}
              onChange={(event) => setSelectedMissionId(event.target.value)}
              className="min-h-12 rounded-2xl border border-black/5 bg-slate-50 px-4 text-sm font-black outline-none focus:border-emerald-300"
            >
              {missionList.map((mission) => (
                <option key={mission.id} value={mission.id}>
                  {mission.order}. {mission.title}
                </option>
              ))}
            </select>
          </label>

          <div className="grid gap-2 sm:grid-cols-2">
            <AdminInput label="Название" value={draft.title} onChange={(value) => updateDraft({ title: value })} />
            <AdminInput label="Длительность" value={draft.duration} onChange={(value) => updateDraft({ duration: value })} />
            <AdminTextarea label="Описание" value={draft.subtitle} onChange={(value) => updateDraft({ subtitle: value })} />
            <AdminInput label="Источник" value={draft.source} onChange={(value) => updateDraft({ source: value })} />
            <AdminNumberInput label="XP" value={draft.xp} onChange={(value) => updateDraft({ xp: value })} />
            <AdminNumberInput label="Звезды" value={draft.stars} onChange={(value) => updateDraft({ stars: value })} />
            <AdminTextarea
              label="Цели, по одной строке"
              value={draft.goals.join("\n")}
              onChange={(value) => updateDraft({ goals: linesFromText(value) })}
            />
          </div>
        </div>

        <div className="mt-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h4 className="font-black">Блоки урока</h4>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">{orderedBlocks.length} блока</span>
          </div>
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {defaultBlockOrder.map((type) => (
              <button
                type="button"
                key={type}
                onClick={() => addBlock(type)}
                className="flex min-h-10 items-center justify-center gap-2 rounded-2xl bg-slate-950 px-3 text-xs font-black text-white"
              >
                <CopyPlus size={14} />
                {contentBlockLabel(type)}
              </button>
            ))}
          </div>
          <div className="grid gap-3">
            {orderedBlocks.map((block, index) => (
              <div key={block.id} className="rounded-[24px] bg-slate-50 p-3">
                <div className="grid grid-cols-[40px_1fr_auto] items-center gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-2xl bg-white text-slate-700">
                    <ContentBlockIcon type={block.type} />
                  </div>
                  <div>
                    <p className="text-sm font-black">{index + 1}. {contentBlockLabel(block.type)}</p>
                    <p className="mt-1 text-xs font-bold text-slate-500">{adminBlockHint(block.type)}</p>
                  </div>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => moveBlock(index, -1)}
                      disabled={index === 0}
                      className="grid h-9 w-9 place-items-center rounded-xl bg-white text-slate-700 disabled:text-slate-300"
                      aria-label="Поднять блок выше"
                    >
                      <ArrowUp size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveBlock(index, 1)}
                      disabled={index === orderedBlocks.length - 1}
                      className="grid h-9 w-9 place-items-center rounded-xl bg-white text-slate-700 disabled:text-slate-300"
                      aria-label="Опустить блок ниже"
                    >
                      <ArrowDown size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => updateDraft({ contentBlocks: draft.contentBlocks.filter((item) => item.id !== block.id) })}
                      disabled={draft.contentBlocks.length === 1}
                      className="grid h-9 w-9 place-items-center rounded-xl bg-white text-rose-600 disabled:text-slate-300"
                      aria-label="Удалить блок"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>

                <div className="mt-3 grid gap-3 rounded-[20px] bg-white p-3">
                  {block.type === "text" && (
                    <>
                      <AdminInput label="Заголовок текстового блока" value={block.title} onChange={(value) => updateBlock(block.id, (current) => current.type === "text" ? { ...current, title: value } : current)} />
                      <AdminTextarea label="Текст" value={block.body} onChange={(value) => updateBlock(block.id, (current) => current.type === "text" ? { ...current, body: value } : current)} />
                      <AdminTextarea
                        label="Пункты, по одной строке"
                        value={(block.bullets ?? []).join("\n")}
                        onChange={(value) => updateBlock(block.id, (current) => current.type === "text" ? { ...current, bullets: linesFromText(value) } : current)}
                      />
                    </>
                  )}

                  {block.type === "video" && (
                    <>
                      <AdminInput label="Заголовок видео" value={block.title} onChange={(value) => updateBlock(block.id, (current) => current.type === "video" ? { ...current, title: value } : current)} />
                      <AdminInput label="Ссылка на видео" value={block.url} onChange={(value) => updateBlock(block.id, (current) => current.type === "video" ? { ...current, url: value } : current)} />
                      <AdminInput label="Длительность видео" value={block.duration} onChange={(value) => updateBlock(block.id, (current) => current.type === "video" ? { ...current, duration: value } : current)} />
                      <AdminTextarea label="Описание видео" value={block.description} onChange={(value) => updateBlock(block.id, (current) => current.type === "video" ? { ...current, description: value } : current)} />
                    </>
                  )}

                  {block.type === "pdf" && (
                    <>
                      <AdminInput label="Название PDF" value={block.title} onChange={(value) => updateBlock(block.id, (current) => current.type === "pdf" ? { ...current, title: value } : current)} />
                      <AdminInput label="Подпись источника" value={block.sourceLabel} onChange={(value) => updateBlock(block.id, (current) => current.type === "pdf" ? { ...current, sourceLabel: value } : current)} />
                      <AdminInput label="Ссылка на PDF-файл" value={block.fileUrl ?? ""} onChange={(value) => updateBlock(block.id, (current) => current.type === "pdf" ? { ...current, fileUrl: value } : current)} />
                      <div className="grid gap-3">
                        {(block.pages ?? []).map((page, pageIndex) => (
                          <div key={`${block.id}-${pageIndex}`} className="rounded-2xl bg-slate-50 p-3">
                            <div className="mb-3 flex items-center justify-between gap-3">
                              <p className="text-xs font-black uppercase text-slate-400">Страница {pageIndex + 1}</p>
                              <button
                                type="button"
                                onClick={() =>
                                  updateBlock(block.id, (current) =>
                                    current.type === "pdf"
                                      ? { ...current, pages: (current.pages ?? []).filter((_, indexToDelete) => indexToDelete !== pageIndex) }
                                      : current,
                                  )
                                }
                                disabled={(block.pages ?? []).length === 1}
                                className="grid h-8 w-8 place-items-center rounded-xl bg-white text-rose-600 disabled:text-slate-300"
                                aria-label="Удалить страницу"
                              >
                                <Trash2 size={15} />
                              </button>
                            </div>
                            <AdminInput
                              label="Заголовок страницы"
                              value={page.title}
                              onChange={(value) =>
                                updateBlock(block.id, (current) =>
                                  current.type === "pdf"
                                    ? {
                                        ...current,
                                        pages: (current.pages ?? []).map((item, itemIndex) => (itemIndex === pageIndex ? { ...item, title: value } : item)),
                                      }
                                    : current,
                                )
                              }
                            />
                            <AdminTextarea
                              label="Текст страницы"
                              value={page.body ?? ""}
                              onChange={(value) =>
                                updateBlock(block.id, (current) =>
                                  current.type === "pdf"
                                    ? {
                                        ...current,
                                        pages: (current.pages ?? []).map((item, itemIndex) => (itemIndex === pageIndex ? { ...item, body: value } : item)),
                                      }
                                    : current,
                                )
                              }
                            />
                            <AdminTextarea
                              label="Пункты страницы"
                              value={(page.bullets ?? []).join("\n")}
                              onChange={(value) =>
                                updateBlock(block.id, (current) =>
                                  current.type === "pdf"
                                    ? {
                                        ...current,
                                        pages: (current.pages ?? []).map((item, itemIndex) =>
                                          itemIndex === pageIndex ? { ...item, bullets: linesFromText(value) } : item,
                                        ),
                                      }
                                    : current,
                                )
                              }
                            />
                          </div>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          updateBlock(block.id, (current) =>
                            current.type === "pdf"
                              ? {
                                  ...current,
                                  pages: [
                                    ...(current.pages ?? []),
                                    {
                                      title: "Новая страница",
                                      body: "Текст страницы",
                                      bullets: [],
                                    },
                                  ],
                                }
                              : current,
                          )
                        }
                        className="flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 text-sm font-black text-white"
                      >
                        <CopyPlus size={16} />
                        Добавить страницу PDF
                      </button>
                    </>
                  )}

                  {block.type === "quiz" && (
                    <>
                      <AdminInput label="Название теста" value={block.title} onChange={(value) => updateBlock(block.id, (current) => current.type === "quiz" ? { ...current, title: value } : current)} />
                      <AdminNumberInput label="Проходной балл" value={block.passScore ?? 85} onChange={(value) => updateBlock(block.id, (current) => current.type === "quiz" ? { ...current, passScore: value } : current)} />
                      <AdminTextarea label="Вопрос" value={block.quiz.question} onChange={(value) => updateBlock(block.id, (current) => current.type === "quiz" ? { ...current, quiz: { ...current.quiz, question: value } } : current)} />
                      <AdminTextarea
                        label="Варианты, по одной строке"
                        value={block.quiz.options.join("\n")}
                        onChange={(value) => updateBlock(block.id, (current) => current.type === "quiz" ? { ...current, quiz: { ...current.quiz, options: linesFromText(value) } } : current)}
                      />
                      <AdminNumberInput
                        label="Правильный вариант, номер"
                        value={block.quiz.answer + 1}
                        onChange={(value) => updateBlock(block.id, (current) => current.type === "quiz" ? { ...current, quiz: { ...current.quiz, answer: Math.max(0, value - 1) } } : current)}
                      />
                      <AdminTextarea label="Объяснение" value={block.quiz.explanation} onChange={(value) => updateBlock(block.id, (current) => current.type === "quiz" ? { ...current, quiz: { ...current.quiz, explanation: value } } : current)} />
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-5 rounded-[24px] bg-[#fffaf1] p-4">
          <h4 className="font-black">Тест задания</h4>
          {draft.quiz ? (
            <div className="mt-3 grid gap-3">
              <AdminNumberInput label="Проходной балл" value={draft.passScore ?? 85} onChange={(value) => updateDraft({ passScore: value })} />
              <AdminTextarea label="Вопрос" value={draft.quiz.question} onChange={(value) => updateQuiz({ question: value })} />
              <AdminTextarea label="Варианты, по одной строке" value={draft.quiz.options.join("\n")} onChange={(value) => updateQuiz({ options: linesFromText(value) })} />
              <AdminNumberInput
                label="Правильный вариант, номер"
                value={(draft.quiz.answer ?? 0) + 1}
                onChange={(value) => updateQuiz({ answer: Math.max(0, value - 1) })}
              />
              <AdminTextarea label="Объяснение ответа" value={draft.quiz.explanation} onChange={(value) => updateQuiz({ explanation: value })} />
            </div>
          ) : (
            <button
              type="button"
              onClick={() =>
                updateDraft({
                  passScore: 85,
                  quiz: {
                    question: "Новый вопрос",
                    options: ["Вариант 1", "Вариант 2", "Вариант 3"],
                    answer: 0,
                    explanation: "Объяснение правильного ответа",
                  },
                })
              }
              className="mt-3 min-h-11 rounded-2xl bg-slate-950 px-4 text-sm font-black text-white"
            >
              Добавить тест к заданию
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => onResetMissionContentDraft(selectedMission.id)}
          className="mt-4 min-h-11 w-full rounded-2xl bg-slate-100 px-4 text-sm font-black text-slate-600"
        >
          Сбросить контент задания
        </button>
      </article>

      <article className="mt-4 rounded-[28px] border border-black/5 bg-white p-5 shadow-sm">
        <h3 className="font-black">Условия допуска</h3>
        <div className="mt-4 grid gap-2">
          {admissionRequirements.map((requirement) => (
            <div key={requirement.id} className="flex items-start gap-3 rounded-2xl bg-slate-50 p-3">
              <div
                className={`mt-0.5 grid h-6 w-6 flex-none place-items-center rounded-full ${
                  requirementStatus[requirement.id] ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"
                }`}
              >
                {requirementStatus[requirement.id] ? <Check size={14} /> : <Lock size={13} />}
              </div>
              <div>
                <p className="text-sm font-black">{requirement.title}</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">{requirement.description}</p>
              </div>
            </div>
          ))}
        </div>
      </article>

      <article className="mt-4 rounded-[28px] border border-black/5 bg-white p-5 shadow-sm">
        <h3 className="font-black">Ежедневный контроль</h3>
        <div className="mt-4 grid gap-2">
          {dailyControls.map((control) => {
            const score = state.mentorScores[control.id] ?? 0;
            return (
              <div key={control.id} className="rounded-2xl bg-slate-50 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-black">{control.title}</p>
                    <p className="mt-1 text-xs text-slate-500">{control.description}</p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-sm font-black ${score >= control.targetScore ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>
                    {score}/5
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </article>

      <article className="mt-4 rounded-[28px] border border-black/5 bg-white p-5 shadow-sm">
        <h3 className="font-black">Комментарий наставника</h3>
        <p className="mt-3 rounded-2xl bg-slate-50 p-4 text-sm font-bold leading-6 text-slate-600">
          {state.mentorComment}
        </p>
      </article>

      <article className="mt-4 rounded-[28px] border border-black/5 bg-white p-5 shadow-sm">
        <h3 className="font-black">Бонусы</h3>
        <div className="mt-4 grid gap-2">
          {bonusRules.map((rule) => (
            <div key={rule.action} className="flex items-center justify-between gap-3 rounded-2xl bg-emerald-50 p-3">
              <span className="text-sm font-bold text-slate-700">{rule.action}</span>
              <span className="text-right text-xs font-black text-emerald-700">{rule.reward}</span>
            </div>
          ))}
        </div>
      </article>

      <article className="mt-4 rounded-[28px] border border-black/5 bg-white p-5 shadow-sm">
        <h3 className="font-black">Штрафы</h3>
        <div className="mt-4 grid gap-2">
          {penaltyRules.map((rule) => (
            <div key={rule.reason} className="flex items-center justify-between gap-3 rounded-2xl bg-rose-50 p-3">
              <span className="text-sm font-bold text-slate-700">{rule.reason}</span>
              <span className="text-right text-xs font-black text-rose-700">{rule.penalty}</span>
            </div>
          ))}
        </div>
      </article>
    </section>
  );
}

function MissionModal({
  mission,
  status,
  blockOrder,
  selectedAnswer,
  isMentorApproved,
  onClose,
  onSelectAnswer,
  onComplete,
}: {
  mission: Mission;
  status: MissionStatus;
  blockOrder?: MissionContentBlockType[];
  selectedAnswer: number | null;
  isMentorApproved: boolean;
  onClose: () => void;
  onSelectAnswer: (answer: number) => void;
  onComplete: () => void;
}) {
  const contentBlocks = getMissionContentBlocks(mission, blockOrder);
  const [stepIndex, setStepIndex] = useState(0);
  const hasQuiz = Boolean(mission.quiz);
  const hasMentorStep = Boolean(mission.requiresMentor);
  const quizStepIndex = contentBlocks.length;
  const mentorStepIndex = contentBlocks.length + (hasQuiz ? 1 : 0);
  const totalSteps = contentBlocks.length + (hasQuiz ? 1 : 0) + (hasMentorStep ? 1 : 0);
  const isContentStep = stepIndex < contentBlocks.length;
  const isQuizStep = hasQuiz && stepIndex === quizStepIndex;
  const isMentorStep = hasMentorStep && stepIndex === mentorStepIndex;
  const isLastStep = stepIndex === totalSteps - 1;
  const canMoveNext = !isQuizStep || selectedAnswer !== null;

  useEffect(() => {
    setStepIndex(0);
  }, [mission.id]);

  return (
    <div
      className="fixed inset-0 z-40 overflow-y-auto bg-[#fbf7f2]"
    >
      <article
        className="mx-auto min-h-screen w-full max-w-6xl px-4 pb-24 pt-4"
      >
        <div className="sticky top-0 z-20 -mx-4 border-b border-[#eadfd4] bg-[#fbf7f2]/95 px-4 py-3 backdrop-blur-xl">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
            <button type="button" onClick={onClose} className="rounded-2xl bg-white px-4 py-3 text-sm font-black shadow-sm">
              Назад
            </button>
            <div className="min-w-0 flex-1 text-center">
              <p className="text-[11px] font-black uppercase text-emerald-700">Миссия {mission.order} · {mission.duration}</p>
              <h2 className="truncate text-lg font-black tracking-tight">{mission.title}</h2>
            </div>
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-950 text-white">
              <MissionIcon mission={mission} />
            </div>
          </div>
        </div>

        <div className="mt-5 rounded-[28px] border border-black/5 bg-white p-5 shadow-sm">
          <h1 className="text-2xl font-black tracking-tight">{mission.title}</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">{mission.subtitle}</p>

          <div className="mt-5 grid grid-cols-3 gap-2">
            <InfoPill label="XP" value={`+${mission.xp}`} />
            <InfoPill label="звезды" value={`+${mission.stars}`} />
            <InfoPill label="формат" value={mission.type === "mentor" ? "практика" : mission.type === "exam" ? "экзамен" : "урок"} />
          </div>

          <div className="mt-5 rounded-full bg-slate-100 p-1">
            <div
              className="h-2 rounded-full bg-gradient-to-r from-[#e3654f] to-[#f5b45b]"
              style={{ width: `${((stepIndex + 1) / totalSteps) * 100}%` }}
            />
          </div>
          <p className="mt-2 text-center text-xs font-black text-slate-400">
            Шаг {stepIndex + 1}/{totalSteps}
          </p>
        </div>

        <div className="mt-5">
          {isContentStep && (
            <MissionBlockCard
              key={contentBlocks[stepIndex].id}
              block={contentBlocks[stepIndex]}
              index={stepIndex}
              total={contentBlocks.length}
            />
          )}
        </div>

        {isQuizStep && mission.quiz && (
          <div className="mt-5 rounded-[24px] border border-black/5 bg-[#fffaf1] p-4">
            <p className="mb-2 text-xs font-black uppercase text-amber-700">Тест</p>
            <h3 className="font-black">{mission.quiz.question}</h3>
            <div className="mt-3 grid gap-2">
              {mission.quiz.options.map((option, index) => {
                const isSelected = selectedAnswer === index;
                const isCorrect = mission.quiz?.answer === index;
                return (
                  <button
                    type="button"
                    key={option}
                    onClick={() => onSelectAnswer(index)}
                    className={`rounded-2xl border px-4 py-3 text-left text-sm font-bold transition ${
                      isSelected && isCorrect
                        ? "border-emerald-300 bg-emerald-100 text-emerald-800"
                        : isSelected
                          ? "border-rose-300 bg-rose-100 text-rose-800"
                          : "border-black/5 bg-white text-slate-700"
                    }`}
                  >
                    {option}
                  </button>
                );
              })}
            </div>
            {selectedAnswer !== null && (
              <p className="mt-3 text-xs font-bold leading-5 text-slate-500">{mission.quiz.explanation}</p>
            )}
          </div>
        )}

        {isMentorStep && mission.requiresMentor && (
          <div className={`mt-5 rounded-[24px] p-4 ${isMentorApproved ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}>
            <div className="flex items-center gap-2 font-black">
              {isMentorApproved ? <BadgeCheck size={18} /> : <ClipboardCheck size={18} />}
              {isMentorApproved ? "Практика подтверждена наставником" : "Нужно подтверждение наставника"}
            </div>
          </div>
        )}

        <div className="mt-5 grid grid-cols-[1fr_1.4fr] gap-2">
          <button
            type="button"
            onClick={() => setStepIndex((current) => Math.max(0, current - 1))}
            disabled={stepIndex === 0}
            className="min-h-14 rounded-[22px] bg-slate-100 px-5 font-black text-slate-700 disabled:text-slate-300"
          >
            Назад
          </button>
          {isLastStep ? (
            <button
              type="button"
              onClick={onComplete}
              disabled={status === "done"}
              className="min-h-14 rounded-[22px] bg-slate-950 px-5 font-black text-white disabled:bg-slate-200 disabled:text-slate-500"
            >
              {status === "done" ? "Миссия уже закрыта" : mission.type === "exam" ? "Получить допуск" : "Завершить миссию"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setStepIndex((current) => Math.min(totalSteps - 1, current + 1))}
              disabled={!canMoveNext}
              className="min-h-14 rounded-[22px] bg-slate-950 px-5 font-black text-white disabled:bg-slate-200 disabled:text-slate-500"
            >
              Далее
            </button>
          )}
        </div>
      </article>
    </div>
  );
}

function createMissionDraft(mission: Mission, blockOrder?: MissionContentBlockType[]): MissionContentDraft {
  return {
    title: mission.title,
    subtitle: mission.subtitle,
    duration: mission.duration,
    xp: mission.xp,
    stars: mission.stars,
    passScore: mission.passScore,
    source: mission.source,
    goals: [...mission.goals],
    contentBlocks: getMissionContentBlocks(mission, blockOrder).map((block) => JSON.parse(JSON.stringify(block)) as MissionContentBlock),
    quiz: mission.quiz
      ? {
          ...mission.quiz,
          options: [...mission.quiz.options],
        }
      : undefined,
  };
}

function applyDraftToMission(mission: Mission, draft: MissionContentDraft): Mission {
  return {
    ...mission,
    title: draft.title,
    subtitle: draft.subtitle,
    duration: draft.duration,
    xp: draft.xp,
    stars: draft.stars,
    passScore: draft.passScore,
    source: draft.source,
    goals: draft.goals,
    contentBlocks: draft.contentBlocks,
    quiz: draft.quiz,
  };
}

function getMissionContentBlocks(mission: Mission, blockOrder?: MissionContentBlockType[]) {
  if (mission.contentBlocks && !blockOrder) return mission.contentBlocks;

  const textBody = mission.lessonCards.map((card) => `${card.title}: ${card.body}`).join("\n\n");
  const baseBlocks: MissionContentBlock[] =
    mission.contentBlocks ?? [
      {
        id: `${mission.id}-text`,
        type: "text",
        title: "Короткий материал",
        body: textBody,
        bullets: mission.goals,
      },
      {
        id: `${mission.id}-video`,
        type: "video",
        title: `Видео: ${mission.title}`,
        description: `Короткий разбор темы "${mission.subtitle}" перед практикой или тестом.`,
        duration: "6 сек",
        url: serviceIntroVideoUrl,
      },
      {
        id: `${mission.id}-pdf`,
        type: "pdf",
        title: "PDF-материал",
        sourceLabel: mission.source,
        pages: [
          ...mission.lessonCards.map((card) => ({
            title: card.title,
            body: card.body,
            bullets: mission.goals.slice(0, 3),
          })),
          {
            title: "Что нужно запомнить",
            body: "Этот материал нужен для закрытия миссии и дальнейшего допуска к самостоятельной работе.",
            bullets: mission.goals,
          },
        ],
      },
    ];
  const order = blockOrder?.length ? blockOrder : defaultBlockOrder;

  return [...baseBlocks].sort((first, second) => {
    const firstIndex = order.indexOf(first.type);
    const secondIndex = order.indexOf(second.type);
    return (firstIndex === -1 ? 99 : firstIndex) - (secondIndex === -1 ? 99 : secondIndex);
  });
}

function MissionBlockCard({ block, index, total }: { block: MissionContentBlock; index: number; total: number }) {
  return (
    <section className="rounded-[24px] border border-black/5 bg-slate-50 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-2xl bg-white text-slate-700 shadow-sm">
            <ContentBlockIcon type={block.type} />
          </span>
          <div>
            <p className="text-[11px] font-black uppercase text-emerald-700">Блок {index + 1}/{total}</p>
            <h3 className="text-sm font-black">{block.title}</h3>
          </div>
        </div>
        <span className="rounded-full bg-white px-3 py-1 text-[10px] font-black text-slate-500">
          {contentBlockLabel(block.type)}
        </span>
      </div>

      {block.type === "text" && <TextContentBlock block={block} />}
      {block.type === "video" && <VideoContentBlock block={block} />}
      {block.type === "pdf" && <PdfPreviewBlock block={block} />}
      {block.type === "quiz" && <InlineQuizBlock block={block} />}
    </section>
  );
}

function TextContentBlock({ block }: { block: Extract<MissionContentBlock, { type: "text" }> }) {
  return (
    <div>
      <p className="whitespace-pre-line text-sm font-bold leading-6 text-slate-600">{block.body}</p>
      {block.bullets && block.bullets.length > 0 && (
        <div className="mt-4 grid gap-2">
          {block.bullets.map((bullet) => (
            <div key={bullet} className="flex items-start gap-2 rounded-2xl bg-white p-3 text-xs font-bold leading-5 text-slate-600">
              <Check className="mt-0.5 flex-none text-emerald-600" size={14} />
              {bullet}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function VideoContentBlock({ block }: { block: Extract<MissionContentBlock, { type: "video" }> }) {
  return (
    <div>
      <div className="relative overflow-hidden rounded-[22px] bg-slate-950">
        <video
          className="aspect-video w-full bg-slate-950 object-cover"
          controls
          controlsList="nodownload noremoteplayback"
          disablePictureInPicture
          onContextMenu={(event) => event.preventDefault()}
          preload="metadata"
          src={block.url}
        />
      </div>
      <div className="mt-3 flex items-start justify-between gap-3">
        <p className="text-xs font-bold leading-5 text-slate-500">{block.description}</p>
        <span className="flex-none rounded-full bg-white px-3 py-1 text-[11px] font-black text-slate-500">{block.duration}</span>
      </div>
    </div>
  );
}

function PdfPreviewBlock({ block }: { block: Extract<MissionContentBlock, { type: "pdf" }> }) {
  const [pageIndex, setPageIndex] = useState(0);
  const [zoom, setZoom] = useState<number | null>(null);
  const [effectiveZoom, setEffectiveZoom] = useState(100);
  const page = block.pages?.[pageIndex];
  const zoomLabel = zoom === null ? "По ширине" : `${zoom}%`;

  const handleZoomOut = () => {
    setZoom((current) => clampPdfZoom((current ?? effectiveZoom) - pdfZoomStep));
  };

  const handleZoomIn = () => {
    setZoom((current) => clampPdfZoom((current ?? effectiveZoom) + pdfZoomStep));
  };

  const handleEffectiveZoomChange = useCallback((value: number) => {
    setEffectiveZoom(value);
  }, []);

  return (
    <div onContextMenu={(event) => event.preventDefault()}>
      <div className="overflow-hidden rounded-[22px] border border-black/5 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/5 bg-[#fffaf1] px-4 py-3">
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase text-amber-700">Просмотр PDF</p>
            <p className="mt-1 break-words text-xs font-bold text-slate-500">{block.sourceLabel}</p>
          </div>
          {block.fileUrl ? (
            <div className="grid grid-cols-[36px_minmax(82px,1fr)_36px] items-center gap-1 rounded-full bg-white p-1">
              <button
                type="button"
                onClick={handleZoomOut}
                className="h-8 rounded-full px-3 text-xs font-black text-slate-600"
              >
                -
              </button>
              <button
                type="button"
                onClick={() => setZoom(null)}
                className={`h-8 rounded-full px-3 text-center text-[11px] font-black ${
                  zoom === null ? "bg-slate-950 text-white" : "text-slate-600"
                }`}
              >
                {zoomLabel}
              </button>
              <button
                type="button"
                onClick={handleZoomIn}
                className="h-8 rounded-full px-3 text-xs font-black text-slate-600"
              >
                +
              </button>
            </div>
          ) : (
            <span className="rounded-full bg-white px-3 py-1 text-[11px] font-black text-slate-600">
              {pageIndex + 1}/{block.pages?.length ?? 1}
            </span>
          )}
        </div>

        <div className="bg-slate-100 p-2 sm:p-4">
          {block.fileUrl ? (
            <PdfFileViewer fileUrl={block.fileUrl} zoom={zoom} setZoom={setZoom} onEffectiveZoomChange={handleEffectiveZoomChange} />
          ) : page?.imageUrl ? (
            <img
              src={page.imageUrl}
              alt={page.title}
              draggable={false}
              className="mx-auto max-h-[72vh] w-full rounded-lg border border-slate-200 bg-white object-contain shadow-[0_10px_30px_rgba(15,23,42,0.08)]"
            />
          ) : (
            <div className="mx-auto min-h-[230px] max-w-[310px] rounded-lg border border-slate-200 bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.08)]">
              <p className="text-[10px] font-black uppercase text-slate-400">Учебный лист</p>
              <h4 className="mt-3 text-lg font-black leading-tight text-slate-900">{page?.title ?? block.title}</h4>
              {page?.body && <p className="mt-3 text-sm font-bold leading-6 text-slate-600">{page.body}</p>}
              {page?.bullets && page.bullets.length > 0 && (
                <ul className="mt-4 grid gap-2">
                  {page.bullets.map((bullet) => (
                    <li key={bullet} className="text-xs font-bold leading-5 text-slate-500">
                      {bullet}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>

      {!block.fileUrl && block.pages && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setPageIndex((current) => Math.max(0, current - 1))}
            disabled={pageIndex === 0}
            className="min-h-11 rounded-2xl bg-white px-4 text-sm font-black text-slate-700 disabled:text-slate-300"
          >
            Назад
          </button>
          <button
            type="button"
            onClick={() => setPageIndex((current) => Math.min(block.pages!.length - 1, current + 1))}
            disabled={pageIndex === block.pages.length - 1}
            className="min-h-11 rounded-2xl bg-slate-950 px-4 text-sm font-black text-white disabled:bg-white disabled:text-slate-300"
          >
            Вперед
          </button>
        </div>
      )}
      <p className="mt-2 text-center text-[11px] font-bold text-slate-400">PDF открыт как файл внутри урока, страницы листаются, масштаб меняется</p>
    </div>
  );
}

function PdfFileViewer({
  fileUrl,
  zoom,
  setZoom,
  onEffectiveZoomChange,
}: {
  fileUrl: string;
  zoom: number | null;
  setZoom: Dispatch<SetStateAction<number | null>>;
  onEffectiveZoomChange: (zoom: number) => void;
}) {
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderTaskRef = useRef<any>(null);
  const effectiveZoomRef = useRef(100);
  const pinchRef = useRef<{ distance: number; zoom: number } | null>(null);
  const [pdfDocument, setPdfDocument] = useState<any>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [viewerWidth, setViewerWidth] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    const updateViewerWidth = () => setViewerWidth(viewer.clientWidth);
    updateViewerWidth();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateViewerWidth);
      return () => window.removeEventListener("resize", updateViewerWidth);
    }

    const resizeObserver = new ResizeObserver(updateViewerWidth);
    resizeObserver.observe(viewer);
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 2) return;

      pinchRef.current = {
        distance: getTouchDistance(event.touches),
        zoom: effectiveZoomRef.current,
      };
      event.preventDefault();
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (event.touches.length !== 2 || !pinchRef.current) return;

      const nextDistance = getTouchDistance(event.touches);
      const nextZoom = clampPdfZoom((pinchRef.current.zoom * nextDistance) / pinchRef.current.distance);
      setZoom((current) => {
        const currentZoom = current ?? effectiveZoomRef.current;
        return Math.abs(currentZoom - nextZoom) < 5 ? current : nextZoom;
      });
      event.preventDefault();
    };

    const handleTouchEnd = (event: TouchEvent) => {
      if (event.touches.length < 2) pinchRef.current = null;
    };

    viewer.addEventListener("touchstart", handleTouchStart, { passive: false });
    viewer.addEventListener("touchmove", handleTouchMove, { passive: false });
    viewer.addEventListener("touchend", handleTouchEnd);
    viewer.addEventListener("touchcancel", handleTouchEnd);

    return () => {
      viewer.removeEventListener("touchstart", handleTouchStart);
      viewer.removeEventListener("touchmove", handleTouchMove);
      viewer.removeEventListener("touchend", handleTouchEnd);
      viewer.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [setZoom]);

  useEffect(() => {
    let cancelled = false;
    let loadedPdfForCleanup: any = null;
    setIsLoading(true);
    setError(null);
    setPdfDocument(null);

    async function loadPdf() {
      let loadedPdf: any = null;
      try {
        const pdfjs = await import("pdfjs-dist/build/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        loadedPdf = await pdfjs.getDocument(fileUrl).promise;
        loadedPdfForCleanup = loadedPdf;

        if (!cancelled) {
          setPdfDocument(loadedPdf);
          setPageCount(loadedPdf.numPages);
          setPageNumber(1);
        } else {
          await loadedPdf.destroy();
        }
      } catch (loadError) {
        console.error("PDF load error", loadError);
        if (!cancelled) setError("PDF не удалось открыть");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    loadPdf();

    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
      loadedPdfForCleanup?.destroy?.();
    };
  }, [fileUrl]);

  useEffect(() => {
    let cancelled = false;

    async function renderPage() {
      if (!pdfDocument || !canvasRef.current) return;

      renderTaskRef.current?.cancel();
      setIsLoading(true);
      setError(null);

      const page = await pdfDocument.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const availableWidth = Math.max(260, viewerWidth - 24);
      const fitZoom = clampPdfZoom((availableWidth / baseViewport.width) * 100);
      const effectiveZoom = zoom ?? fitZoom;
      const viewport = page.getViewport({ scale: effectiveZoom / 100 });
      const canvas = canvasRef.current;
      const context = canvas.getContext("2d");
      if (!context) return;

      effectiveZoomRef.current = effectiveZoom;
      onEffectiveZoomChange(effectiveZoom);

      const maxCanvasPixels = 6_000_000;
      const deviceScale = window.devicePixelRatio || 1;
      const maxOutputScale = Math.sqrt(maxCanvasPixels / (viewport.width * viewport.height));
      const outputScale = Math.max(0.75, Math.min(deviceScale, 1.5, maxOutputScale));
      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;

      context.setTransform(outputScale, 0, 0, outputScale, 0, 0);
      context.clearRect(0, 0, viewport.width, viewport.height);

      const renderTask = page.render({ canvas, canvasContext: context, viewport });
      renderTaskRef.current = renderTask;
      await renderTask.promise;

      if (!cancelled) {
        renderTaskRef.current = null;
        page.cleanup?.();
      }
    }

    renderPage()
      .catch((renderError) => {
        if (cancelled || renderError?.name === "RenderingCancelledException") return;
        console.error("PDF render error", renderError);
        setError("Страницу PDF не удалось отрисовать");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
    };
  }, [onEffectiveZoomChange, pdfDocument, pageNumber, viewerWidth, zoom]);

  return (
    <div>
      <div className="mb-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <button
          type="button"
          onClick={() => setPageNumber((current) => Math.max(1, current - 1))}
          disabled={pageNumber === 1 || isLoading}
          className="min-h-10 rounded-2xl bg-white px-3 text-xs font-black text-slate-700 disabled:text-slate-300 sm:px-4 sm:text-sm"
        >
          Стр. назад
        </button>
        <span className="rounded-full bg-white px-4 py-2 text-xs font-black text-slate-600">
          {isLoading ? "Загрузка" : `${pageNumber}/${pageCount}`}
        </span>
        <button
          type="button"
          onClick={() => setPageNumber((current) => Math.min(pageCount, current + 1))}
          disabled={pageNumber === pageCount || isLoading}
          className="min-h-10 rounded-2xl bg-white px-3 text-xs font-black text-slate-700 disabled:text-slate-300 sm:px-4 sm:text-sm"
        >
          Стр. вперед
        </button>
      </div>

      <div
        ref={viewerRef}
        className="h-[72vh] min-h-[420px] overflow-auto overscroll-contain rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_10px_30px_rgba(15,23,42,0.08)] sm:min-h-[620px] sm:p-4"
      >
        <canvas ref={canvasRef} className={`mx-auto bg-white ${error ? "hidden" : "block"}`} />
        {error && (
          <div className="grid min-h-[420px] place-items-center text-center text-sm font-black text-rose-700">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

function InlineQuizBlock({ block }: { block: Extract<MissionContentBlock, { type: "quiz" }> }) {
  const [answer, setAnswer] = useState<number | null>(null);

  return (
    <div className="rounded-[22px] bg-[#fffaf1] p-4">
      <h4 className="font-black">{block.quiz.question}</h4>
      <div className="mt-3 grid gap-2">
        {block.quiz.options.map((option, index) => {
          const isSelected = answer === index;
          const isCorrect = block.quiz.answer === index;

          return (
            <button
              type="button"
              key={option}
              onClick={() => setAnswer(index)}
              className={`rounded-2xl border px-4 py-3 text-left text-sm font-bold transition ${
                isSelected && isCorrect
                  ? "border-emerald-300 bg-emerald-100 text-emerald-800"
                  : isSelected
                    ? "border-rose-300 bg-rose-100 text-rose-800"
                    : "border-black/5 bg-white text-slate-700"
              }`}
            >
              {option}
            </button>
          );
        })}
      </div>
      {answer !== null && <p className="mt-3 text-xs font-bold leading-5 text-slate-500">{block.quiz.explanation}</p>}
    </div>
  );
}

function ContentBlockIcon({ type }: { type: MissionContentBlockType }) {
  if (type === "quiz") return <ClipboardCheck size={18} />;
  if (type === "video") return <PlayCircle size={18} />;
  if (type === "pdf") return <FileText size={18} />;
  return <BookOpenCheck size={18} />;
}

function contentBlockLabel(type: MissionContentBlockType) {
  if (type === "quiz") return "Тест";
  if (type === "video") return "Видео";
  if (type === "pdf") return "PDF";
  return "Текст";
}

function adminBlockHint(type: MissionContentBlockType) {
  if (type === "quiz") return "Проверочный вопрос внутри урока";
  if (type === "video") return "Видеоурок или демонстрация стандарта";
  if (type === "pdf") return "Материал для просмотра без скачивания";
  return "Текст, цели и ключевые правила";
}

function linesFromText(value: string) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function AdminInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="grid gap-2">
      <span className="text-[11px] font-black uppercase text-slate-400">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-11 rounded-2xl border border-black/5 bg-white px-4 text-sm font-bold text-slate-700 outline-none focus:border-emerald-300"
      />
    </label>
  );
}

function AdminNumberInput({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="grid gap-2">
      <span className="text-[11px] font-black uppercase text-slate-400">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="min-h-11 rounded-2xl border border-black/5 bg-white px-4 text-sm font-bold text-slate-700 outline-none focus:border-emerald-300"
      />
    </label>
  );
}

function AdminTextarea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="grid gap-2">
      <span className="text-[11px] font-black uppercase text-slate-400">{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-24 resize-none rounded-2xl border border-black/5 bg-white px-4 py-3 text-sm font-bold leading-6 text-slate-700 outline-none focus:border-emerald-300"
      />
    </label>
  );
}

function SectionTitle({ eyebrow, title, action }: { eyebrow: string; title: string; action: string }) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <p className="text-xs font-black uppercase text-emerald-700">{eyebrow}</p>
        <h2 className="text-xl font-black tracking-tight">{title}</h2>
      </div>
      <span className="max-w-36 truncate rounded-full bg-emerald-100 px-3 py-2 text-xs font-black text-emerald-800">
        {action}
      </span>
    </div>
  );
}

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-slate-50 p-3">
      <p className="font-black">{value}</p>
      <p className="mt-1 text-[11px] font-bold text-slate-500">{label}</p>
    </div>
  );
}

function AdminMetric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <article className="rounded-[24px] border border-black/5 bg-white p-4 shadow-sm">
      <p className="text-xs font-black uppercase text-slate-400">{label}</p>
      <h3 className="mt-1 text-xl font-black">{value}</h3>
      <p className="mt-1 text-sm leading-6 text-slate-500">{hint}</p>
    </article>
  );
}
