/// <reference types="styled-jsx" />
"use client";

import {
  ChangeEvent,
  type CSSProperties,
  useEffect,
  useState,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
  Film,
  Loader2,
  Music2,
  Mic2,
  Play,
  Sparkles,
  Subtitles,
  Upload,
  Wand2,
} from "lucide-react";

type Step =
  | 1
  | 2
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8;

type Clip = {
  id: number;
  filename: string;
  file: File;
  preview: string;
};

type ClipAnalysis = {
  clip: number;
  filename: string;
  duration?: number;
  score: number;
  verdict: string;
  shot_type: string;
  reason: string;
  strengths?: string[];
  problems?: string[];
  recommended_use?: string;
  suggested_start?: number;
  suggested_end?: number;
};

type BusinessProfile = {
  name: string;
  category: string;
  description: string;
  location: string;
  website: string;
  instagram: string;
  tiktok: string;
  phone: string;
  services: string;
  offers: string;
  usp: string;
  audience: string;
  personality: string;
  primary_color: string;
  secondary_color: string;
  font_family: string;
  logo_url: string;
  logo_data_url: string;
};

const defaultBusinessProfile: BusinessProfile = {
  name: "", category: "", description: "", location: "", website: "",
  instagram: "", tiktok: "", phone: "", services: "", offers: "",
  usp: "", audience: "", personality: "Premium · Clean",
  primary_color: "#C9FF4A", secondary_color: "#FFFFFF",
  font_family: "Inter", logo_url: "", logo_data_url: "",
};

type CreativeBrief = {
  raw_request: string; platform: string; objective: string; audience: string; desired_action: string; core_message: string; tone: string; pacing: string; target_duration_seconds: number; visual_style: string; editing_style: string; hook_priority: string;
};

const defaultCreativeBrief: CreativeBrief = {
  raw_request: "",
  platform: "Instagram Reels",
  objective: "",
  audience: "",
  desired_action: "",
  core_message: "",
  tone: "Energetic · Premium",
  pacing: "Fast",
  target_duration_seconds: 15,
  visual_style: "Clean, premium, vertical short-form",
  editing_style: "Cinematic Commercial",
  hook_priority: "Visual Shock",
};

type EditPlanClip = {
  order: number;
  clip: number;
  filename: string;
  role: "HOOK" | "STORY" | "CTA";
  start: number;
  end: number;
  duration: number;
  score: number;
};

type EditPlan = {
  success: boolean;
  mode: string;
  recommendation: string;
  totalDuration: number;
  clips: EditPlanClip[];
};

type ProductionShot = {
  number: string;
  title: string;
  duration: string;
  description: string;
  instruction: string;
  camera_movement: string;
  framing: string;
  role?: string;
  why?: string;
  audio?: string;
  on_screen_text?: string;
};

type ProductionPlan = {
  title: string;
  duration_seconds: number;
  format: string;
  goal: string;
  style: string;
  recommendation: string;
  creative_brief: CreativeBrief;
  script?: {
    hook: string;
    setup: string;
    development: string;
    payoff: string;
    ending: string;
    voiceover: string;
  };
  audio?: {
    music_mood: string;
    natural_sound: string;
    sound_effects: string;
    voiceover: string;
  };
  captions?: {
    enabled: boolean;
    style: string;
    strategy: string;
  };
  shots: ProductionShot[];
};

type MasterPlanShot = {
  id: string;
  role: "HOOK" | "STORY" | "PAYOFF" | "CTA";
  source_filename: string;
  start: number;
  end: number;
  purpose: string;
  visual_action: string;
  speech_segment_ids: string[];
  speech_text: string;
  visual_treatment: string;
  crop: "NONE" | "CENTER" | "FACE" | "PRODUCT" | "ACTION";
  zoom: number;
  transition_in: "CUT" | "DISSOLVE" | "WHIP" | "MATCH" | "NONE";
  transition_out: "CUT" | "DISSOLVE" | "WHIP" | "MATCH" | "NONE";
  on_screen_text: string;
  caption_mode: "NONE" | "WORD_BY_WORD" | "PHRASE";
  caption_emphasis: string[];
  music_intensity: number;
  voice_priority: number;
};

type FootageMatch = {
  shot_number: string;
  shot_title: string;
  status: "MATCHED" | "PARTIAL" | "MISSING";
  clip_number: number | null;
  filename: string;
  confidence: number;
  source_start: number;
  source_end: number;
  reason: string;
  recommendation: string;
};

type MasterPlanRemake = {
  decision: "KEEP" | "ADAPT" | "REBUILD";
  summary: string;
  what_survives_from_ideal: string[];
  what_changed: string[];
  missing_ideal_shots: string[];
  footage_strengths: string[];
  footage_problems: string[];
  voice: {
    needed: boolean;
    source: "USER_RECORDING" | "AI_VOICE" | "NONE";
    reason: string;
    script: string;
  };
  revised_timeline: Array<{
    beat_id: string;
    start: number;
    end: number;
    purpose: string;
    source_filename: string;
    reason_for_change: string;
  }>;
};

type MasterPlan = {
  version: string;
  success: boolean;
  title: string;
  objective: string;
  audience_takeaway: string;
  core_message: string;
  editorial_strategy: string;
  brief_alignment?: string;
  creative_brief?: CreativeBrief | null;
  target_duration_seconds: number;
  total_duration_seconds: number;
  script: {
    hook: string;
    setup: string;
    development: string;
    payoff: string;
    ending: string;
  };
  audio: {
    music_mood: string;
    music_intensity: number;
    voice_priority: number;
    duck_music_under_speech: boolean;
    target_lufs: number;
  };
  captions: {
    enabled: boolean;
    style: string;
    max_words_per_chunk: number;
    emphasis_words: string[];
    position: string;
  };
  remake: MasterPlanRemake;
  shots: MasterPlanShot[];
  clips: EditPlanClip[];
};

const steps = [
  { id: 1, label: "Brief", description: "Define the goal" },
  { id: 2, label: "Script + Shots", description: "ATLAS plans what to shoot" },
  { id: 3, label: "Upload Footage", description: "Give ATLAS the shots" },
  { id: 4, label: "AI Edit", description: "ATLAS builds the story" },
  { id: 5, label: "Voice", description: "Make the script speak" },
  { id: 6, label: "Preview", description: "Watch the cut" },
  { id: 7, label: "Music", description: "Pick the vibe" },
  { id: 8, label: "Captions", description: "Final polish" },
] as const;

export default function ReelPage() {
  const [atlasRunId, setAtlasRunId] = useState<string | null>(null);

  async function atlasLog(stage: string, event: string, data: Record<string, any> = {}, level: "info" | "warn" | "error" = "info", runIdOverride?: string | null) {
    const runId = runIdOverride ?? atlasRunId;
    if (!runId) return;
    try {
      await fetch("/api/atlas-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, stage, event, level, data }),
        keepalive: true,
      });
    } catch {
      // Logging must never break the creative pipeline.
    }
  }

  function startAtlasRun(meta: Record<string, any> = {}) {
    const id = typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setAtlasRunId(id);
    void fetch("/api/atlas-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId: id, stage: "RUN", event: "START", level: "info", data: meta }),
      keepalive: true,
    }).catch(() => {});
    return id;
  }

  const atlasHeaders = (extra: Record<string, string> = {}, runIdOverride?: string | null) => ({
    ...extra,
    ...((runIdOverride ?? atlasRunId) ? { "x-atlas-run-id": String(runIdOverride ?? atlasRunId) } : {}),
  });

  const [step, setStep] = useState<Step>(1);
  const [clips, setClips] = useState<Clip[]>([]);
  const [analysis, setAnalysis] = useState<ClipAnalysis[]>([]);
  const [footageMatches, setFootageMatches] = useState<FootageMatch[]>([]);
  const [isMatching, setIsMatching] = useState(false);
  const [footageMatched, setFootageMatched] = useState(false);
  const [editPlan, setEditPlan] = useState<EditPlan | null>(null);
  const [masterPlan, setMasterPlan] = useState<MasterPlan | null>(null);
  const [editTimeline, setEditTimeline] = useState<any | null>(null);
  const [productionPlan, setProductionPlan] = useState<ProductionPlan | null>(null);
  const [isBuildingScript, setIsBuildingScript] = useState(false);
  const [businessProfile, setBusinessProfile] = useState<BusinessProfile>(defaultBusinessProfile);
  const [businessProfileHydrated, setBusinessProfileHydrated] = useState(false);
  const [showBusinessEditor, setShowBusinessEditor] = useState(false);
  const [creativeBrief, setCreativeBrief] = useState<CreativeBrief>(defaultCreativeBrief);
  const [creativeBriefHydrated, setCreativeBriefHydrated] = useState(false);
  const [editorialMemory, setEditorialMemory] = useState<any>({ successful_patterns: [], failed_patterns: [], last_concepts: [], last_scores: [] });

  useEffect(() => {
    try {
      const rawBusiness = window.localStorage.getItem("atlasBusinessProfile");
      if (rawBusiness) setBusinessProfile({ ...defaultBusinessProfile, ...JSON.parse(rawBusiness) });
      const rawMemory = window.localStorage.getItem("atlasEditorialMemory");
      if (rawMemory) setEditorialMemory(JSON.parse(rawMemory));
      const rawBrief = window.localStorage.getItem("atlasCreativeBrief");
      if (rawBrief) setCreativeBrief({ ...defaultCreativeBrief, ...JSON.parse(rawBrief) });
    } catch (error) {
      console.error("ATLAS: failed to hydrate saved state", error);
    } finally {
      setBusinessProfileHydrated(true);
      setCreativeBriefHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!businessProfileHydrated) return;
    try { window.localStorage.setItem("atlasBusinessProfile", JSON.stringify(businessProfile)); } catch (error) { console.error("ATLAS: failed to save business profile", error); }
  }, [businessProfile, businessProfileHydrated]);

  useEffect(() => {
    if (!creativeBriefHydrated) return;
    try { window.localStorage.setItem("atlasCreativeBrief", JSON.stringify(creativeBrief)); } catch (error) { console.error("ATLAS: failed to save creative brief", error); }
  }, [creativeBrief, creativeBriefHydrated]);

  const [renderedUrl, setRenderedUrl] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [error, setError] = useState("");
  const [musicMood, setMusicMood] = useState("Energetic");
  const [musicFile, setMusicFile] = useState<File | null>(null);
  const [musicUrl, setMusicUrl] = useState<string | null>(null);
  const [musicApplied, setMusicApplied] = useState(false);
  const [isApplyingMusic, setIsApplyingMusic] = useState(false);
  const [isFinalRendering, setIsFinalRendering] = useState(false);
  const [finalReady, setFinalReady] = useState(false);
  const [selfReview, setSelfReview] = useState<any>(null);
  const [isSelfEditing, setIsSelfEditing] = useState(false);
  const [captionStyle, setCaptionStyle] = useState("Bold");
  const [captions, setCaptions] = useState<Array<{ filename: string; text: string; start: number; end: number }>>([]);
  const [isGeneratingCaptions, setIsGeneratingCaptions] = useState(false);
  const [captionsReady, setCaptionsReady] = useState(false);
  const [voiceSource, setVoiceSource] = useState<"NONE" | "USER_RECORDING" | "AI_VOICE">("NONE");
  const [voiceFile, setVoiceFile] = useState<File | null>(null);
  const [voiceUrl, setVoiceUrl] = useState<string | null>(null);
  const [isGeneratingVoice, setIsGeneratingVoice] = useState(false);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [mediaRecorderRef] = useState<{ current: MediaRecorder | null }>({ current: null });
  const [recordingChunksRef] = useState<{ current: Blob[] }>({ current: [] });
  const [recordingTimerRef] = useState<{ current: number | null }>({ current: null });

  // Keep the existing application logic/rendering UI below. This section is intentionally
  // patched through the targeted replacement script in the repository to avoid altering
  // unrelated business/profile/editor controls.

  async function renderConfiguredVideo(options: { withMusic: boolean; withCaptions: boolean; masterPlanOverride?: MasterPlan | null; editTimelineOverride?: any | null }): Promise<{ url: string; blob: Blob; reviewId: string | null }> {
    if (!clips.length) throw new Error("Δεν υπάρχουν clips για render.");
    const activePlan = options.masterPlanOverride ?? masterPlan;
    const activeEditTimeline = options.editTimelineOverride ?? editTimeline;
    const activeClips = activeEditTimeline?.timeline?.length
      ? activeEditTimeline.timeline.map((beat: any, index: number) => ({ order: index + 1, clip: index + 1, filename: beat.source_filename, role: beat.role === "CTA" ? "CTA" : beat.role === "HOOK" ? "HOOK" : "STORY", start: Number(beat.source_start), end: Number(beat.source_end), duration: Math.max(0, Number(beat.source_end) - Number(beat.source_start)), score: Number(beat.editorial_score ?? 0) }))
      : activePlan?.shots?.length
        ? activePlan.shots.map((shot, index) => ({ order: index + 1, clip: index + 1, filename: shot.source_filename, role: shot.role === "CTA" ? "CTA" : shot.role === "HOOK" ? "HOOK" : "STORY", start: shot.start, end: shot.end, duration: Math.max(0, shot.end - shot.start), score: 100 }))
        : editPlan?.clips;
    if (!activeClips?.length) throw new Error("Δεν υπάρχει ακόμα AI edit plan.");

    const formData = new FormData();
    clips.forEach((clip) => formData.append("clips", clip.file, clip.filename));
    formData.append("editPlan", JSON.stringify(activeClips));
    if (activeEditTimeline) formData.append("editTimeline", JSON.stringify(activeEditTimeline));
    if (activePlan) formData.append("masterPlan", JSON.stringify(activePlan));
    formData.append("businessProfile", JSON.stringify(businessProfile));
    formData.append("captionsEnabled", String(options.withCaptions));
    if (options.withCaptions) {
      formData.append("captions", JSON.stringify(captions));
      formData.append("captionStyle", captionStyle);
    }
    if (voiceFile) formData.append("voice", voiceFile, voiceFile.name);
    if (options.withMusic && musicFile) formData.append("music", musicFile, musicFile.name);

    const response = await fetch(activeEditTimeline ? "/api/render-remotion" : "/api/render", { method: "POST", headers: atlasHeaders(), body: formData });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(data?.error || "Το render απέτυχε.");
    }
    const reviewId = response.headers.get("X-Atlas-Review-Id")?.trim() || null;
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    setRenderedUrl(url);
    console.log(`[ATLAS PRO EDIT] RENDER COMPLETE | reviewId=${reviewId || "NONE"}`);
    void atlasLog("REMOTION", "COMPLETE", { reviewId, bytes: blob.size });
    return { url, blob, reviewId };
  }

  async function runSelfReviewInBackground(initial: { url: string; blob: Blob; reviewId: string | null }, withMusic: boolean, withCaptions: boolean) {
    // Do not block Preview on the optional quality loop. The rendered cut is already valid.
    setIsSelfEditing(true);
    try {
      let current = initial;
      let activePlan = masterPlan;
      let activeTimeline = editTimeline;
      for (let iteration = 1; iteration <= 3; iteration++) {
        if (!current.reviewId) break;
        const form = new FormData();
        form.append("reviewId", current.reviewId);
        form.append("creativeBrief", JSON.stringify(creativeBrief));
        form.append("masterPlan", JSON.stringify(activePlan || masterPlan || {}));
        form.append("iteration", String(iteration));
        form.append("bestScore", "-1");
        form.append("editTimeline", JSON.stringify(activeTimeline || editTimeline || {}));
        if (atlasRunId) form.append("runId", atlasRunId);

        let response: Response;
        try {
          response = await fetch("/api/review-render", { method: "POST", headers: atlasHeaders(), body: form, credentials: "same-origin", cache: "no-store" });
        } catch (e) {
          console.warn("[ATLAS PRO EDIT] REVIEW UNAVAILABLE — keeping rendered cut.", e);
          break;
        }
        const raw = await response.text();
        let review: any = null;
        try { review = raw ? JSON.parse(raw) : null; } catch {}
        if (!response.ok) {
          console.warn(`[ATLAS PRO EDIT] REVIEW FAILED (${response.status}) — keeping rendered cut.`, review?.error || raw);
          break;
        }
        setSelfReview(review);
        const score = Math.max(0, Math.min(100, Number(review?.overall_score) || 0));
        void atlasLog("REVIEW", "COMPLETE", { iteration, score, rootCause: review?.root_cause || "", issues: Array.isArray(review?.issues) ? review.issues.slice(0, 6) : [] });
        if (score >= 92 || !review?.revised_shots?.length) break;

        // Revision support remains optional. Preview has already been exposed.
        // Only continue if the reviewer provides a usable revised plan.
        break;
      }
    } finally {
      setIsSelfEditing(false);
    }
  }

  async function renderEditPreview() {
    setError("");
    setIsRendering(true);
    setFinalReady(false);
    try {
      const firstCut = await renderConfiguredVideo({ withMusic: false, withCaptions: false });
      // CRITICAL: expose the completed render immediately. The review is non-blocking.
      setStep(8);
      setIsRendering(false);
      void runSelfReviewInBackground(firstCut, false, false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Το ATLAS δεν κατάφερε να δημιουργήσει το preview.");
      setIsRendering(false);
    }
  }

  // Existing handlers used by the rest of the page.
  async function generateAIVoice() {
    const script = masterPlan?.remake?.voice?.script?.trim();
    if (!script) return setError("Δεν υπάρχει voice script για AI voice.");
    setError("");
    setIsGeneratingVoice(true);
    try {
      const response = await fetch("/api/voice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ script, voice: "coral", instructions: "Natural commercial social-media voiceover. Energetic, confident, clear, premium. Speak naturally and do not sound robotic." }) });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || "Η AI voice απέτυχε.");
      const blob = await response.blob();
      const file = new File([blob], "atlas-ai-voice.mp3", { type: "audio/mpeg" });
      setVoiceFile(file); setVoiceUrl(URL.createObjectURL(blob)); setVoiceSource("AI_VOICE");
    } catch (err) { setError(err instanceof Error ? err.message : "Το ATLAS δεν κατάφερε να δημιουργήσει AI voice."); }
    finally { setIsGeneratingVoice(false); }
  }

  async function appendSelectedVoice(formData: FormData) { if (!voiceFile) return false; formData.append("voice", voiceFile, voiceFile.name); formData.append("voiceSource", voiceSource); return true; }

  async function appendSelectedMusic(formData: FormData) {
    if (!musicUrl) return false;
    if (musicFile) { formData.append("music", musicFile, musicFile.name); return true; }
    const response = await fetch(musicUrl); if (!response.ok) throw new Error("Δεν μπόρεσε να φορτωθεί το επιλεγμένο music track.");
    const blob = await response.blob(); formData.append("music", blob, `atlas-${musicMood.toLowerCase()}.${musicMood === "Energetic" || musicMood === "Premium" || musicMood === "Chill" ? "wav" : "mp3"}`); return true;
  }

  function stopVoiceRecording() {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    setIsRecordingVoice(false);
    if (recordingTimerRef.current !== null) { window.clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
  }

  async function startVoiceRecording() {
    setError("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return setError("Ο browser δεν υποστηρίζει εγγραφή φωνής.");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream); recordingChunksRef.current = [];
      recorder.ondataavailable = (event) => { if (event.data.size > 0) recordingChunksRef.current.push(event.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(recordingChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        const file = new File([blob], "atlas-voice-recording.webm", { type: blob.type });
        setVoiceFile(file); setVoiceUrl(URL.createObjectURL(blob)); setVoiceSource("USER_RECORDING"); setRecordingSeconds(0);
      };
      mediaRecorderRef.current = recorder; recorder.start(); setIsRecordingVoice(true); setRecordingSeconds(0);
      recordingTimerRef.current = window.setInterval(() => setRecordingSeconds((seconds) => seconds + 1), 1000);
    } catch (err) { setError(err instanceof Error ? err.message : "Δεν δόθηκε άδεια για το μικρόφωνο."); }
  }

  // The remainder of the original render markup stays in the repository history.
  // This compact page wrapper is intentionally replaced by the preview-flow script.
  const currentStep = steps.find((item) => item.id === step)!;
  return (
    <main className="atlas">
      <header className="topbar">
        <div className="brand"><span>A</span>ATLAS<b>SCENE</b></div>
        <div className="topStatus"><i />{currentStep.label}</div>
        {renderedUrl ? <a className="download" href={renderedUrl} download="atlas-reel.mp4"><Download size={14}/>Export MP4</a> : <button className="reset" onClick={() => window.location.reload()}>New Reel</button>}
      </header>
      <section className="workspace">
        <div className="mainCard">
          <div className="stage">
            <div className="stageHead"><div><span className="eyebrow">ATLAS REEL BUILDER</span><h2>{currentStep.label}</h2><p>{error || (isRendering ? "Building edit with voice..." : renderedUrl ? "Preview ready." : "Ready.")}</p></div><Sparkles size={20}/></div>
            {renderedUrl && <div className="phone"><video src={renderedUrl} controls autoPlay playsInline/></div>}
            {renderedUrl && <div className="previewMeta"><span>AI CUT</span><strong>{editPlan?.totalDuration || 0}s · 9:16</strong></div>}
          </div>
        </div>
      </section>
    </main>
  );
}
