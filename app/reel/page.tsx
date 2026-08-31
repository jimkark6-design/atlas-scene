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
    // First event is sent directly because state updates are asynchronous.
    void fetch("/api/atlas-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        runId: id,
        stage: "RUN",
        event: "START",
        level: "info",
        data: meta,
      }),
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
  const [editPlan, setEditPlan] =
    useState<EditPlan | null>(null);

  const [masterPlan, setMasterPlan] =
    useState<MasterPlan | null>(null);

  // AI Edit Director V2 executable timeline.
  // Master Director decides WHAT; Edit Director decides HOW.
  const [editTimeline, setEditTimeline] =
    useState<any | null>(null);

  const [productionPlan, setProductionPlan] =
    useState<ProductionPlan | null>(null);
  const [isBuildingScript, setIsBuildingScript] =
    useState(false);

  const [businessProfile, setBusinessProfile] = useState<BusinessProfile>(defaultBusinessProfile);
  const [businessProfileHydrated, setBusinessProfileHydrated] = useState(false);
  const [showBusinessEditor, setShowBusinessEditor] = useState(false);
  const [creativeBrief, setCreativeBrief] = useState<CreativeBrief>(defaultCreativeBrief);
  const [creativeBriefHydrated, setCreativeBriefHydrated] = useState(false);
  const [editorialMemory, setEditorialMemory] = useState<any>({
    successful_patterns: [],
    failed_patterns: [],
    last_concepts: [],
    last_scores: [],
  });

  // Hydrate persisted ATLAS state before allowing any auto-save.
  // This prevents the initial empty React state from overwriting a saved profile.
  useEffect(() => {
    try {
      const rawBusiness = window.localStorage.getItem("atlasBusinessProfile");
      if (rawBusiness) {
        const parsed = JSON.parse(rawBusiness);
        setBusinessProfile({ ...defaultBusinessProfile, ...parsed });
      }

      const rawMemory = window.localStorage.getItem("atlasEditorialMemory");
      if (rawMemory) {
        setEditorialMemory(JSON.parse(rawMemory));
      }

      const rawBrief = window.localStorage.getItem("atlasCreativeBrief");
      if (rawBrief) {
        const parsed = JSON.parse(rawBrief);
        setCreativeBrief({ ...defaultCreativeBrief, ...parsed });
      }
    } catch (error) {
      console.error("ATLAS: failed to hydrate saved state", error);
    } finally {
      setBusinessProfileHydrated(true);
      setCreativeBriefHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!businessProfileHydrated) return;

    try {
      window.localStorage.setItem(
        "atlasBusinessProfile",
        JSON.stringify(businessProfile)
      );
      console.log(
        "ATLAS BUSINESS PROFILE SAVED:",
        businessProfile.name || "(empty)"
      );
    } catch (error) {
      console.error("ATLAS: failed to save business profile", error);
    }
  }, [businessProfile, businessProfileHydrated]);

  useEffect(() => {
    if (!creativeBriefHydrated) return;

    try {
      window.localStorage.setItem(
        "atlasCreativeBrief",
        JSON.stringify(creativeBrief)
      );
    } catch (error) {
      console.error("ATLAS: failed to save creative brief", error);
    }
  }, [creativeBrief, creativeBriefHydrated]);

  const [renderedUrl, setRenderedUrl] =
    useState<string | null>(null);

  const [isAnalyzing, setIsAnalyzing] =
    useState(false);

  const [isRendering, setIsRendering] =
    useState(false);

  const [error, setError] =
    useState("");

  const [musicMood, setMusicMood] =
    useState("Energetic");

  const [musicFile, setMusicFile] =
    useState<File | null>(null);

  const [musicUrl, setMusicUrl] =
    useState<string | null>(null);

  const [musicApplied, setMusicApplied] =
    useState(false);

  const [isApplyingMusic, setIsApplyingMusic] =
    useState(false);

  const [isFinalRendering, setIsFinalRendering] =
    useState(false);

  const [finalReady, setFinalReady] =
    useState(false);

  const [selfReview, setSelfReview] = useState<{
    iteration: number;
    overall_score: number;
    verdict: "PASS" | "REVISE";
    summary: string;
    issues: Array<{ severity: string; category: string; timestamp_seconds: number; problem: string; fix: string }>;
  } | null>(null);
  const [isSelfEditing, setIsSelfEditing] = useState(false);

  const [captionStyle, setCaptionStyle] =
    useState("Bold");

  const [captions, setCaptions] =
    useState<
      Array<{
        filename: string;
        text: string;
        start: number;
        end: number;
      }>
    >([]);

  const [isGeneratingCaptions, setIsGeneratingCaptions] =
    useState(false);

  const [captionsReady, setCaptionsReady] =
    useState(false);

  const [voiceSource, setVoiceSource] =
    useState<"NONE" | "USER_RECORDING" | "AI_VOICE">("NONE");
  const [voiceFile, setVoiceFile] =
    useState<File | null>(null);
  const [voiceUrl, setVoiceUrl] =
    useState<string | null>(null);
  const [isGeneratingVoice, setIsGeneratingVoice] =
    useState(false);
  const [isRecordingVoice, setIsRecordingVoice] =
    useState(false);
  const [recordingSeconds, setRecordingSeconds] =
    useState(0);
  const mediaRecorderRef =
    useState<{ current: MediaRecorder | null }>({ current: null })[0];
  const recordingChunksRef =
    useState<{ current: Blob[] }>({ current: [] })[0];
  const recordingTimerRef =
    useState<{ current: number | null }>({ current: null })[0];

  function addVideos(
    event: ChangeEvent<HTMLInputElement>
  ) {
    const files =
      Array.from(
        event.target.files || []
      );

    if (!files.length) return;

    const next = files.map(
      (file, index) => ({
        id:
          Date.now() +
          index,
        filename:
          file.name,
        file,
        preview:
          URL.createObjectURL(file),
      })
    );

    setClips((current) => [
      ...current,
      ...next,
    ]);

    setError("");
    setStep(3);
  }

  async function buildScriptAndShootingPlan() {
    if (!creativeBrief.objective.trim()) {
      setError("Πες πρώτα στο ATLAS τι πρέπει να πετύχει αυτό το Reel.");
      return;
    }

    setError("");
    setIsBuildingScript(true);

    try {
      const response = await fetch("/api/director", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brief: creativeBrief.objective,
          creative_brief: creativeBrief,
          business_profile: businessProfile,
          editorial_memory: editorialMemory,
        }),
      });

      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Το ATLAS δεν κατάφερε να φτιάξει το shooting plan.");

      setProductionPlan(data as ProductionPlan);
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Το ATLAS δεν κατάφερε να φτιάξει το shooting plan.");
    } finally {
      setIsBuildingScript(false);
    }
  }

  async function analyzeAndPlan() {
    if (!creativeBrief.objective.trim()) {
      setError("Πες πρώτα στο ATLAS τι πρέπει να πετύχει αυτό το Reel.");
      return;
    }

    if (!productionPlan) {
      setError("Φτιάξε πρώτα το Script & Shooting Plan.");
      setStep(2);
      return;
    }

    if (!clips.length) {
      setError("Ανέβασε πρώτα τουλάχιστον ένα video.");
      return;
    }

    setError("");
    setIsAnalyzing(true);
    setIsMatching(true);
    setFootageMatched(false);

    const runId = startAtlasRun({
      objective: creativeBrief.objective,
      clipCount: clips.length,
      pipeline: "ATLAS_PRO_EDITOR_V2",
    });

    try {
      void fetch("/api/atlas-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, stage: "ANALYSIS", event: "START", level: "info", data: { clips: clips.length } }),
        keepalive: true,
      }).catch(() => {});
      const formData = new FormData();
      clips.forEach((clip) => formData.append("clips", clip.file, clip.filename));

      const analyzeResponse = await fetch("/api/analyze", {
        method: "POST",
        headers: atlasHeaders({}, runId),
        body: formData,
      });
      const analyzeData = await analyzeResponse.json().catch(() => null);
      if (!analyzeResponse.ok) throw new Error(analyzeData?.error || "Το AI analysis απέτυχε.");

      const results = Array.isArray(analyzeData?.clips) ? analyzeData.clips : [];
      setAnalysis(results);
      void atlasLog("ANALYSIS", "COMPLETE", { clips: results.length }, "info", runId);

      const matchResponse = await fetch("/api/match-footage", {
        method: "POST",
        headers: atlasHeaders({ "Content-Type": "application/json" }, runId),
        body: JSON.stringify({
          production_plan: productionPlan,
          analyses: results,
          creative_brief: creativeBrief,
          business_profile: businessProfile,
        }),
      });
      const matchData = await matchResponse.json().catch(() => null);
      if (!matchResponse.ok) throw new Error(matchData?.error || "Το ATLAS δεν κατάφερε να αντιστοιχίσει τα videos με το shooting plan.");

      const matches = Array.isArray(matchData?.matches) ? matchData.matches as FootageMatch[] : [];
      setFootageMatches(matches);
      setFootageMatched(true);
      void atlasLog("MATCH_FOOTAGE", "COMPLETE", { matches: matches.length }, "info", runId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Το ATLAS δεν κατάφερε να αναλύσει το footage.");
    } finally {
      setIsMatching(false);
      setIsAnalyzing(false);
    }
  }

  async function continueToMasterEdit() {
    if (!productionPlan || !analysis.length || !footageMatches.length) {
      setError("Ολοκλήρωσε πρώτα το footage matching.");
      return;
    }

    setError("");
    setIsAnalyzing(true);

    try {
      const formData = new FormData();
      clips.forEach((clip) => formData.append("clips", clip.file, clip.filename));

      let transcript: any[] = [];
      try {
        const transcriptResponse = await fetch("/api/transcribe", {
          method: "POST",
          headers: atlasHeaders(),
          body: formData,
        });
        const transcriptData = await transcriptResponse.json().catch(() => null);
        if (transcriptResponse.ok) {
          const raw = transcriptData?.captions ?? transcriptData?.segments ?? transcriptData?.results ?? [];
          transcript = Array.isArray(raw)
            ? raw.map((item: any, index: number) => ({
                id: String(item.id ?? `speech-${index + 1}`),
                filename: String(item.filename ?? item.file ?? ""),
                text: String(item.text ?? item.caption ?? ""),
                start: Number(item.start ?? 0),
                end: Number(item.end ?? 0),
                words: Array.isArray(item.words) ? item.words.map((word: any) => ({
                  word: String(word.word ?? ""), start: Number(word.start ?? 0), end: Number(word.end ?? 0),
                })) : [],
              })).filter((item) => item.text.trim() && item.end > item.start)
            : [];
          setCaptions(transcript);
          setCaptionsReady(transcript.length > 0);
        }
      } catch (transcriptionError) {
        console.warn("ATLAS pre-plan transcription skipped:", transcriptionError);
      }

      const planResponse = await fetch("/api/master-plan", {
        method: "POST",
        headers: atlasHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          clips: analysis,
          captions: transcript,
          creative_brief: creativeBrief,
          production_plan: productionPlan,
          footage_matches: footageMatches,
          business_profile: businessProfile,
        }),
      });
      const planData = await planResponse.json().catch(() => null);
      if (!planResponse.ok) throw new Error(planData?.error || "Ο ATLAS Master Director απέτυχε.");

      const master = planData as MasterPlan;
      void atlasLog("MASTER_PLAN", "COMPLETE", { shots: Array.isArray((master as any)?.shots) ? (master as any).shots.length : 0 });

      // ============================================================
      // ATLAS PRO EDITOR V2
      // Master Director decides WHAT.
      // AI Edit Director decides HOW.
      // Remotion executes the resulting executable timeline.
      // ============================================================
      const editDirectorResponse = await fetch("/api/edit-director", {
        method: "POST",
        headers: atlasHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          creative_brief: creativeBrief,
          master_plan: master,
          clips: analysis,
          footage_matches: footageMatches,
          captions: transcript,
          business_profile: businessProfile,
          editorial_memory: editorialMemory,
        }),
      });

      const editDirectorData =
        await editDirectorResponse.json().catch(() => null);

      if (!editDirectorResponse.ok) {
        throw new Error(
          editDirectorData?.error ||
            "Ο AI Edit Director απέτυχε."
        );
      }

      if (
        !editDirectorData?.timeline ||
        !Array.isArray(editDirectorData.timeline) ||
        editDirectorData.timeline.length < 5
      ) {
        throw new Error(
          "Ο AI Edit Director δεν επέστρεψε έγκυρο executable timeline."
        );
      }

      setEditTimeline(editDirectorData);
      void atlasLog("EDIT_DIRECTOR", "COMPLETE", {
        beats: editDirectorData.timeline.length,
        speedRamps: editDirectorData.timeline.filter((b: any) => Array.isArray(b.speed_curve) && b.speed_curve.length > 1).length,
        sfxEvents: editDirectorData.timeline.reduce((n: number, b: any) => n + (Array.isArray(b.sfx_events) ? b.sfx_events.length : 0), 0),
        text: editDirectorData.timeline.filter((b: any) => String(b.text || "").trim()).length,
      });
      if (editDirectorData?.creative_strategy) {
        setEditorialMemory((prev: any) => ({
          ...prev,
          last_concepts: [editDirectorData.creative_strategy.concept, ...(prev.last_concepts || [])].slice(0, 8),
        }));
      }

      const masterWithEditTimeline = {
        ...(master as any),
        edit_timeline: editDirectorData,
      };

      setMasterPlan(masterWithEditTimeline as MasterPlan);

      setEditPlan({
        success: true,
        mode: "ATLAS EDITING INTELLIGENCE V3",
        recommendation:
          editDirectorData.editorial_intent ||
          master.editorial_strategy,
        totalDuration: Number(
          editDirectorData.timeline
            .reduce(
              (sum: number, beat: any) =>
                sum +
                Math.max(
                  0,
                  Number(beat.source_end) -
                    Number(beat.source_start)
                ),
              0
            )
            .toFixed(2)
        ),
        clips: editDirectorData.timeline.map(
          (beat: any, index: number) => ({
            order: index + 1,
            clip: index + 1,
            filename: beat.source_filename,
            role:
              beat.role === "CTA"
                ? "CTA"
                : beat.role === "HOOK"
                  ? "HOOK"
                  : "STORY",
            start: Number(beat.source_start),
            end: Number(beat.source_end),
            duration: Math.max(
              0,
              Number(beat.source_end) -
                Number(beat.source_start)
            ),
            score: Number(beat.editorial_score ?? 0),
          })
        ),
      });

      console.log(
        `[ATLAS PRO EDITOR V2] EXECUTABLE TIMELINE READY | beats=${editDirectorData.timeline.length}`
      );

      setStep(4);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Το ATLAS δεν κατάφερε να χτίσει το edit.");
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function generateCaptions() {
    const realClips = clips.filter((clip) => clip.file);

    if (!realClips.length) {
      setError("Δεν υπάρχουν πραγματικά clips για transcription.");
      return;
    }

    setError("");
    setIsGeneratingCaptions(true);

    try {
      const formData = new FormData();

      realClips.forEach((clip) => {
        if (clip.file) {
          formData.append(
            "clips",
            clip.file,
            clip.filename
          );
        }
      });

      const response = await fetch(
        "/api/transcribe",
        {
          method: "POST",
          body: formData,
        }
      );

      const data = await response
        .json()
        .catch(() => null);

      if (!response.ok) {
        throw new Error(
          data?.error ||
            "Η μεταγραφή απέτυχε."
        );
      }

      const raw =
        data?.captions ??
        data?.segments ??
        data?.results ??
        [];

      const normalized = Array.isArray(raw)
        ? raw
            .map((item: any) => ({
              filename: String(
                item.filename ??
                  item.file ??
                  ""
              ),
              text: String(
                item.text ??
                  item.caption ??
                  ""
              ),
              start: Number(
                item.start ?? 0
              ),
              end: Number(
                item.end ?? 0
              ),
            }))
            .filter(
              (item) =>
                item.text.trim() &&
                item.end > item.start
            )
        : [];

      setCaptions(normalized);
      setCaptionsReady(true);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Το ATLAS δεν κατάφερε να δημιουργήσει captions."
      );
    } finally {
      setIsGeneratingCaptions(false);
    }
  }

  function stopVoiceRecording() {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    setIsRecordingVoice(false);
    if (recordingTimerRef.current !== null) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  }

  async function startVoiceRecording() {
    setError("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Ο browser δεν υποστηρίζει εγγραφή φωνής.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recordingChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordingChunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(recordingChunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        const file = new File([blob], "atlas-voice-recording.webm", { type: blob.type });
        if (voiceUrl) URL.revokeObjectURL(voiceUrl);
        setVoiceFile(file);
        setVoiceUrl(URL.createObjectURL(file));
        setVoiceSource("USER_RECORDING");
        setRecordingSeconds(0);
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecordingVoice(true);
      setRecordingSeconds(0);

      recordingTimerRef.current = window.setInterval(
        () => setRecordingSeconds((seconds) => seconds + 1),
        1000
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Δεν δόθηκε άδεια για το μικρόφωνο.");
    }
  }

  async function generateAIVoice() {
    const script = masterPlan?.remake?.voice?.script?.trim();
    if (!script) {
      setError("Δεν υπάρχει voice script για AI voice.");
      return;
    }

    setError("");
    setIsGeneratingVoice(true);

    try {
      const response = await fetch("/api/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          script,
          voice: "coral",
          instructions:
            "Natural commercial social-media voiceover. Energetic, confident, clear, premium. Speak naturally and do not sound robotic.",
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "Η AI voice απέτυχε.");
      }

      const blob = await response.blob();
      if (voiceUrl) URL.revokeObjectURL(voiceUrl);
      const file = new File([blob], "atlas-ai-voice.mp3", { type: "audio/mpeg" });
      setVoiceFile(file);
      setVoiceUrl(URL.createObjectURL(blob));
      setVoiceSource("AI_VOICE");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Το ATLAS δεν κατάφερε να δημιουργήσει AI voice.");
    } finally {
      setIsGeneratingVoice(false);
    }
  }

  async function appendSelectedVoice(formData: FormData) {
    if (!voiceFile) return false;
    formData.append("voice", voiceFile, voiceFile.name);
    formData.append("voiceSource", voiceSource);
    return true;
  }

  async function appendSelectedMusic(formData: FormData) {
    if (!musicUrl) return false;

    if (musicFile) {
      formData.append(
        "music",
        musicFile,
        musicFile.name
      );
      return true;
    }

    const response = await fetch(musicUrl);
    if (!response.ok) {
      throw new Error(
        "Δεν μπόρεσε να φορτωθεί το επιλεγμένο music track."
      );
    }

    const blob = await response.blob();
    const extension =
      musicMood === "Energetic" ||
      musicMood === "Premium" ||
      musicMood === "Chill"
        ? "wav"
        : "mp3";

    formData.append(
      "music",
      blob,
      `atlas-${musicMood.toLowerCase()}.${extension}`
    );

    return true;
  }

  async function renderConfiguredVideo(options: {
    withMusic: boolean;
    withCaptions: boolean;
    masterPlanOverride?: MasterPlan | null;
    editTimelineOverride?: any | null;
  }): Promise<{
    url: string;
    blob: Blob;
    reviewId: string | null;
  }> {
    if (!clips.length) {
      throw new Error(
        "Δεν υπάρχουν clips για render."
      );
    }

    const activePlan = options.masterPlanOverride ?? masterPlan;
    const activeEditTimeline =
      options.editTimelineOverride ?? editTimeline;

    const activeClips = activeEditTimeline?.timeline?.length
      ? activeEditTimeline.timeline.map((beat: any, index: number) => ({
          order: index + 1,
          clip: index + 1,
          filename: beat.source_filename,
          role:
            beat.role === "CTA"
              ? "CTA"
              : beat.role === "HOOK"
                ? "HOOK"
                : "STORY",
          start: Number(beat.source_start),
          end: Number(beat.source_end),
          duration: Math.max(
            0,
            Number(beat.source_end) -
              Number(beat.source_start)
          ),
          score: Number(beat.editorial_score ?? 0),
        }))
      : activePlan?.shots?.length
        ? activePlan.shots.map((shot, index) => ({
            order: index + 1,
            clip: index + 1,
            filename: shot.source_filename,
            role: shot.role === "CTA" ? "CTA" : shot.role === "HOOK" ? "HOOK" : "STORY",
            start: shot.start,
            end: shot.end,
            duration: Math.max(0, shot.end - shot.start),
            score: 100,
          }))
        : editPlan?.clips;

    if (!activeClips?.length) {
      throw new Error(
        "Δεν υπάρχει ακόμα AI edit plan."
      );
    }

    const formData = new FormData();

    clips.forEach((clip) => {
      formData.append(
        "clips",
        clip.file,
        clip.filename
      );
    });

    formData.append(
      "editPlan",
      JSON.stringify(activeClips)
    );

    if (activeEditTimeline) {
      formData.append(
        "editTimeline",
        JSON.stringify(activeEditTimeline)
      );
    }

    if (activePlan) {
      formData.append(
        "masterPlan",
        JSON.stringify(activePlan)
      );
    }

    formData.append(
      "businessProfile",
      JSON.stringify(businessProfile)
    );

    formData.append(
      "captionsEnabled",
      String(options.withCaptions)
    );

    if (options.withCaptions) {
      formData.append(
        "captions",
        JSON.stringify(captions)
      );
      formData.append(
        "captionStyle",
        captionStyle
      );
    }

    if (voiceFile) {
      await appendSelectedVoice(formData);
    }

    if (options.withMusic) {
      await appendSelectedMusic(formData);
    }

    const response = await fetch(
      activeEditTimeline
        ? "/api/render-remotion"
        : "/api/render",
      {
        method: "POST",
        headers: atlasHeaders(),
        body: formData,
      }
    );

    if (!response.ok) {
      const data = await response
        .json()
        .catch(() => null);

      throw new Error(
        data?.error ||
          "Το render απέτυχε."
      );
    }

    // V9 stores the rendered MP4 server-side and exposes the review cache
    // identifier in this response header. The reviewer must receive this id,
    // not the MP4 blob.
    const reviewId =
      response.headers.get("X-Atlas-Review-Id")?.trim() || null;

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);

    setRenderedUrl(url);

    console.log(
      `[ATLAS PRO EDIT] RENDER COMPLETE | reviewId=${reviewId || "NONE"}`
    );
    void atlasLog("REMOTION", "COMPLETE", { reviewId, bytes: blob.size });

    return {
      url,
      blob,
      reviewId,
    };
  }


  function mergeReviewedPlan(review: any, basePlan: MasterPlan | null): MasterPlan | null {
    if (!basePlan || !Array.isArray(review?.revised_shots) || !review.revised_shots.length) return null;
    const originalById = new Map(basePlan.shots.map(shot => [shot.id, shot]));
    const revised = review.revised_shots.map((candidate: any, index: number) => {
      const base = originalById.get(String(candidate?.id || "")) || basePlan.shots[index];
      if (!base) return null;
      return { ...base, ...candidate, id: base.id, source_filename: base.source_filename, start: Number(candidate?.start ?? base.start), end: Number(candidate?.end ?? base.end) };
    }).filter(Boolean) as MasterPlanShot[];
    if (!revised.length) return null;
    return { ...basePlan, shots: revised, total_duration_seconds: Number(revised.reduce((sum, shot) => sum + Math.max(0, shot.end - shot.start), 0).toFixed(2)), clips: revised.map((shot, i) => ({ order: i + 1, clip: i + 1, filename: shot.source_filename, role: shot.role === "CTA" ? "CTA" : shot.role === "HOOK" ? "HOOK" : "STORY", start: shot.start, end: shot.end, duration: Math.max(0, shot.end - shot.start), score: 100 })) as EditPlanClip[] };
  }

  async function selfOptimizeRenderedCut(
    initial: {
      url: string;
      blob: Blob;
      reviewId: string | null;
    },
    withMusic: boolean,
    withCaptions: boolean
  ) {
    let current = initial;
    let activePlan = masterPlan;
    let activeTimeline = editTimeline;
    let best = initial;
    let bestScore = -1;
    let bestReview: any = null;

    setIsSelfEditing(true);

    try {
      // ATLAS never replaces a stronger cut with a weaker revision.
      // The reviewer is an optimizer, not a destructive loop.
      for (let iteration = 1; iteration <= 3; iteration++) {
        console.log(
          `[ATLAS PRO EDIT] REVIEW PASS ${iteration}: evaluating current cut...`
        );

        /*
         * V9 SERVER-SIDE REVIEW
         *
         * /api/render already stored the rendered MP4 server-side.
         * We MUST NOT upload the MP4 again.
         * We only send the review cache id.
         */
        if (!current.reviewId) {
          console.warn(
            "[ATLAS PRO EDIT] No reviewId returned by /api/render. Skipping review."
          );
          break;
        }

        const form = new FormData();

        form.append("reviewId", current.reviewId);
        form.append(
          "creativeBrief",
          JSON.stringify(creativeBrief)
        );
        form.append(
          "masterPlan",
          JSON.stringify(activePlan || masterPlan || {})
        );
        form.append("iteration", String(iteration));
        form.append("bestScore", String(bestScore));
        form.append("editTimeline", JSON.stringify(activeTimeline || editTimeline || {}));
        if (atlasRunId) form.append("runId", atlasRunId);

        console.log(
          `[ATLAS PRO EDIT] SERVER REVIEW | reviewId=${current.reviewId}`
        );

        let response: Response;

        try {
          response = await fetch("/api/review-render", {
            method: "POST",
            headers: atlasHeaders(),
            body: form,
            credentials: "same-origin",
            cache: "no-store",
          });
        } catch (reviewFetchError) {
          console.warn(
            "[ATLAS PRO EDIT] REVIEW UNAVAILABLE — keeping the rendered cut.",
            reviewFetchError
          );
          break;
        }

        const raw = await response.text();

        let review: any = null;

        try {
          review = raw ? JSON.parse(raw) : null;
        } catch {
          review = null;
        }

        // Review is an optional optimization layer.
        // A review failure must NEVER hide a successfully rendered cut.
        if (!response.ok) {
          console.warn(
            `[ATLAS PRO EDIT] REVIEW FAILED (${response.status}) — keeping current/best render.`,
            review?.error || raw
          );
          break;
        }

        const score = Math.max(
          0,
          Math.min(
            100,
            Number(review?.overall_score) || 0
          )
        );

        setSelfReview(review);
        void atlasLog("REVIEW", "COMPLETE", {
          iteration,
          score,
          rootCause: review?.root_cause || "",
          issues: Array.isArray(review?.issues) ? review.issues.slice(0, 6) : [],
        });

        console.log(
          `[ATLAS PRO EDIT] SCORE ${score}/100 | BEST ${
            bestScore < 0 ? "none" : bestScore
          }`
        );

        if (score > bestScore) {
          bestScore = score;
          best = current;
          bestReview = review;

          console.log(
            `[ATLAS PRO EDIT] NEW BEST CUT: ${score}/100`
          );
        } else {
          console.log(
            `[ATLAS PRO EDIT] DISCARDING WEAKER CUT: ${score}/100`
          );

          // Do not keep chaining revisions from a regression.
          // The best cut is already locked and will be restored below.
          if (bestScore >= 0 && score < bestScore) {
            console.log(
              `[ATLAS PRO EDIT] REGRESSION LOCK — stopping revision chain at ${score}/100; best=${bestScore}/100`
            );
            break;
          }
        }

        // A very strong cut is done. Do not risk degrading it.
        if (
          score >= 92 ||
          !review?.revised_shots?.length
        ) {
          break;
        }

        const revisedPlan =
          mergeReviewedPlan(
            review,
            activePlan
          );

        if (!revisedPlan) {
          console.warn(
            "[ATLAS PRO EDIT] Reviewer returned no usable revised plan."
          );
          break;
        }

        // Hard creative guardrails: revisions must remain a real Reel.
        const baseDuration = Number(
          activePlan?.total_duration_seconds ||
          masterPlan?.total_duration_seconds ||
          15
        );

        const revisedDuration = Number(
          revisedPlan.total_duration_seconds || 0
        );

        const minDuration =
          baseDuration >= 12
            ? Number((baseDuration * 0.90).toFixed(2))
            : Number((baseDuration * 0.85).toFixed(2));

        const maxDuration =
          baseDuration >= 12
            ? Number((baseDuration * 1.03).toFixed(2))
            : Number((baseDuration * 1.08).toFixed(2));

        const shotCount =
          revisedPlan.shots.length;

        const minimumShots = Math.min(
          5,
          activePlan?.shots?.length || 5
        );

        if (
          revisedDuration < minDuration ||
          revisedDuration > maxDuration ||
          shotCount < minimumShots
        ) {
          console.log(
            `[ATLAS PRO EDIT] REJECTING DESTRUCTIVE REVISION: ${revisedDuration.toFixed(
              2
            )}s / ${shotCount} shots`
          );
          break;
        }

        activePlan = revisedPlan;
        setMasterPlan(revisedPlan);

        // ============================================================
        // REVIEW -> AI EDIT DIRECTOR V2
        // The reviewer gives editorial feedback.
        // AI Edit Director V2 converts it into a NEW executable timeline.
        // ============================================================
        try {
          const v2Response = await fetch(
            "/api/edit-director",
            {
              method: "POST",
              headers: atlasHeaders({
                "Content-Type": "application/json",
              }),
              body: JSON.stringify({
                creative_brief: creativeBrief,
                master_plan: revisedPlan,
                clips: analysis,
                footage_matches: footageMatches,
                captions,
                review,
                business_profile: businessProfile,
                editorial_memory: editorialMemory,
              }),
            }
          );

          const v2Data =
            await v2Response.json().catch(() => null);

          if (!v2Response.ok) {
            throw new Error(
              v2Data?.error ||
                "AI Edit Director V2 failed."
            );
          }

          if (
            !v2Data?.timeline ||
            !Array.isArray(v2Data.timeline) ||
            v2Data.timeline.length < 5
          ) {
            throw new Error(
              "AI Edit Director V2 returned an invalid timeline."
            );
          }

          activeTimeline = v2Data;
          setEditTimeline(v2Data);

          console.log(
            `[ATLAS EDITORIAL INTELLIGENCE] NEW TIMELINE | beats=${v2Data.timeline.length}`
          );
        } catch (editDirectorError) {
          console.warn(
            "[ATLAS PRO EDITOR V2] Failed to regenerate timeline; keeping previous timeline.",
            editDirectorError
          );
        }

        setEditPlan({
          success: true,
          mode: "ATLAS EDITING INTELLIGENCE V3 · SELF-EDITED",
          recommendation:
            review.summary ||
            "ATLAS improved the cut.",
          totalDuration:
            revisedPlan.total_duration_seconds,
          clips: revisedPlan.clips,
        });

        console.log(
          `[ATLAS PRO EDIT] RE-RENDERING REVISION PASS ${iteration}...`
        );

        /*
         * IMPORTANT:
         * This creates a NEW server-side review cache and therefore
         * returns a NEW reviewId for the next review pass.
         */
        const candidate =
          await renderConfiguredVideo({
            withMusic,
            withCaptions,
            masterPlanOverride:
              revisedPlan,
            editTimelineOverride:
              activeTimeline,
          });

        current = candidate;
      }
    } finally {
      setIsSelfEditing(false);
    }

    if (bestReview) {
      setSelfReview(bestReview);
      setEditorialMemory((prev: any) => {
        const next = {
          ...prev,
          last_scores: [bestScore, ...(prev.last_scores || [])].slice(0, 8),
          successful_patterns: [
            ...(prev.successful_patterns || []),
            ...(bestReview.strengths || []).slice(0, 3),
          ].slice(-12),
          failed_patterns: [
            ...(prev.failed_patterns || []),
            ...(bestReview.issues || []).filter((x: any) => x.severity !== "LOW").map((x: any) => x.problem),
          ].slice(-12),
        };
        try { window.localStorage.setItem("atlasEditorialMemory", JSON.stringify(next)); } catch {}
        return next;
      });
    }

    // If no review succeeded, the original render is still a valid cut.
    setRenderedUrl(best.url);

    console.log(
      `[ATLAS PRO EDIT] FINAL BEST CUT SCORE: ${
        bestScore >= 0
          ? bestScore
          : "unreviewed"
      }`
    );

    return best;
  }

  async function renderEditPreview() {
    setError("");
    setIsRendering(true);
    setFinalReady(false);

    try {
      const firstCut = await renderConfiguredVideo({
        withMusic: false,
        withCaptions: false,
      });

      // The rendered MP4 is already a valid preview. Show it immediately.
      // Self-review/re-rendering is an optional background optimization layer
      // and must never block the user from seeing the successful first cut.
      setStep(8);

      void selfOptimizeRenderedCut(firstCut, false, false).catch((reviewError) => {
        console.warn(
          "[ATLAS PRO EDIT] Background self-review failed; keeping first render.",
          reviewError
        );
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Το ATLAS δεν κατάφερε να δημιουργήσει το preview."
      );
    } finally {
      setIsRendering(false);
    }
  }

  async function applyMusic() {
    if (!musicUrl) {
      setError(
        "Διάλεξε πρώτα ένα music track."
      );
      return;
    }

    setError("");
    setIsApplyingMusic(true);

    try {
      await renderConfiguredVideo({
        withMusic: true,
        withCaptions: false,
      });

      setMusicApplied(true);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Το ATLAS δεν κατάφερε να βάλει τη μουσική στο preview."
      );
    } finally {
      setIsApplyingMusic(false);
    }
  }

  async function renderFinalReel() {
    if (!captionsReady) {
      setError(
        "Κάνε πρώτα Generate captions."
      );
      return;
    }

    setError("");
    setIsFinalRendering(true);

    try {
      const firstFinal = await renderConfiguredVideo({
        withMusic: Boolean(musicUrl),
        withCaptions: true,
      });
      await selfOptimizeRenderedCut(firstFinal, Boolean(musicUrl), true);

      setFinalReady(true);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Το τελικό render απέτυχε."
      );
    } finally {
      setIsFinalRendering(false);
    }
  }

  function resetProject() {
    setClips([]);
    setAnalysis([]);
    setFootageMatches([]);
    setFootageMatched(false);
    setEditPlan(null);
    setEditTimeline(null);
    setMasterPlan(null);
    setProductionPlan(null);
    setRenderedUrl(null);
    if (voiceUrl) URL.revokeObjectURL(voiceUrl);
    setVoiceUrl(null);
    setVoiceFile(null);
    setVoiceSource("NONE");
    setMusicApplied(false);
    setFinalReady(false);
    setSelfReview(null);
    setCreativeBrief(defaultCreativeBrief);
    setError("");
    setStep(1);
  }

  const currentStep =
    steps.find(
      (item) =>
        item.id === step
    )!;

  const inputStyle: CSSProperties = { width: "100%", boxSizing: "border-box", background: "#0b0d0f", color: "#f5f6f8", border: "1px solid #252a27", borderRadius: "10px", padding: "11px", font: "inherit" };
  const labelStyle: CSSProperties = { display: "grid", gap: "5px", fontSize: "11px", color: "#89928b" };
  const selectStyle: CSSProperties = { background: "#111412", color: "#f5f6f8", border: "1px solid #252a27", borderRadius: "9px", padding: "10px" };

  return (
    <main className="atlas">
      <header className="topbar">
        <div className="brand">
          <span>A</span>
          ATLAS
          <b>SCENE</b>
        </div>

        <div className="topStatus">
          <i />
          {currentStep.label}
        </div>

        {renderedUrl ? (
          <a
            className="download"
            href={renderedUrl}
            download="atlas-reel.mp4"
          >
            <Download size={14} />
            Export MP4
          </a>
        ) : (
          <button
            className="reset"
            onClick={resetProject}
          >
            New Reel
          </button>
        )}
      </header>

      <section className="hero">
        <div>
          <span className="eyebrow">
            ATLAS REEL BUILDER
          </span>

          <h1>
            Build the Reel.
            <br />
            <em>One creative decision at a time.</em>
          </h1>

          <p>
            Tell ATLAS what the Reel must achieve. Then give it the footage.
            ATLAS keeps that goal in context while directing the entire edit.
          </p>
        </div>
      </section>

      <nav className="steps">
        {steps.map((item) => {
          const done =
            item.id < step;
          const active =
            item.id === step;

          return (
            <button
              key={item.id}
              className={`step ${
                active
                  ? "active"
                  : done
                    ? "done"
                    : ""
              }`}
              onClick={() => {
                if (
                  item.id <= step
                ) {
                  setStep(
                    item.id as Step
                  );
                }
              }}
            >
              <span className="stepNumber">
                {done ? (
                  <Check size={13} />
                ) : (
                  item.id
                )}
              </span>

              <span>
                <strong>
                  {item.label}
                </strong>
                <small>
                  {item.description}
                </small>
              </span>
            </button>
          );
        })}
      </nav>

      <section className="workspace">
        <div className="mainCard">
          {step === 1 && (
            <div className="stage">
              <div className="stageHead"><div><span className="eyebrow">STEP 01 · CREATIVE BRIEF</span><h2>Define what this Reel must achieve.</h2><p>Before ATLAS sees any footage, it decides what the finished Reel needs to accomplish.</p></div><Sparkles size={20} /></div>
              <div style={{ display: "grid", gap: "14px", marginBottom: "18px" }}>
                <div style={{
                  border: "1px solid rgba(180,255,80,.16)",
                  borderRadius: "14px",
                  padding: "11px 13px",
                  background: "linear-gradient(135deg, rgba(180,255,80,.045), rgba(255,255,255,.012))"
                }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
                      {businessProfile.logo_data_url ? (
                        <img src={businessProfile.logo_data_url} alt="Business logo" style={{ width: "36px", height: "36px", objectFit: "contain", borderRadius: "9px", background: "#111412", border: "1px solid #252a27", flexShrink: 0 }} />
                      ) : (
                        <div style={{ width: "36px", height: "36px", borderRadius: "9px", display: "grid", placeItems: "center", background: "rgba(180,255,80,.08)", border: "1px solid rgba(180,255,80,.16)", color: "#c9ff4a", fontWeight: 800, fontSize: "12px", flexShrink: 0 }}>
                          {(businessProfile.name || "Business").slice(0, 2).toUpperCase()}
                        </div>
                      )}
                      <div style={{ minWidth: 0 }}>
                        <div className="eyebrow" style={{ marginBottom: "3px" }}>BUSINESS CONTEXT</div>
                        <strong style={{ display: "block", color: "#f4f7ef", fontSize: "13px", lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {businessProfile.name || "Business not set"}
                        </strong>
                        <span style={{ display: "block", color: "#8e9888", fontSize: "10px", marginTop: "3px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {[businessProfile.category, businessProfile.location].filter(Boolean).join(" · ") || "Set your business profile first"}
                        </span>
                      </div>
                    </div>
                    <button type="button" className="secondary" onClick={() => { window.location.href = "/business"; }} style={{ flexShrink: 0, padding: "8px 11px", fontSize: "10px" }}>
                      Edit business
                    </button>
                  </div>
                </div>

                <div style={{ border: "1px solid #202522", borderRadius: "14px", padding: "16px", background: "#0b0d0f" }}>
                  <div className="eyebrow">01 · THIS REEL</div>
                  <p style={{ color: "#9aa58f", fontSize: "12px", margin: "6px 0 14px" }}>Describe only what is different about this Reel. ATLAS already knows the business.</p>
                  <div style={{ display: "grid", gap: "10px" }}>
                    <textarea value={creativeBrief.objective} onChange={(e) => setCreativeBrief((b) => ({ ...b, objective: e.target.value, raw_request: e.target.value }))} placeholder="What are we promoting? Example: Ceramic coating for premium car owners." rows={3} style={{ ...inputStyle, resize: "vertical", font: "inherit" }} />
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                      <input value={creativeBrief.desired_action} onChange={(e) => setCreativeBrief((b) => ({ ...b, desired_action: e.target.value }))} placeholder="Goal / CTA — e.g. Book an appointment." style={{ ...inputStyle }} />
                      <input value={creativeBrief.core_message} onChange={(e) => setCreativeBrief((b) => ({ ...b, core_message: e.target.value }))} placeholder="Key takeaway — e.g. Premium protection, done right." style={{ ...inputStyle }} />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px" }}>
                      <label style={labelStyle}>Platform<select value={creativeBrief.platform} onChange={(e) => setCreativeBrief((b) => ({ ...b, platform: e.target.value }))} style={selectStyle}><option>Instagram Reels</option><option>TikTok</option><option>YouTube Shorts</option></select></label>
                      <label style={labelStyle}>Style<select value={creativeBrief.editing_style} onChange={(e) => setCreativeBrief((b) => ({ ...b, editing_style: e.target.value }))} style={selectStyle}><option>Cinematic Commercial</option><option>Fast Viral</option><option>Luxury / Premium</option><option>UGC / Authentic</option><option>Product Launch</option></select></label>
                      <label style={labelStyle}>Duration<select value={creativeBrief.target_duration_seconds} onChange={(e) => setCreativeBrief((b) => ({ ...b, target_duration_seconds: Number(e.target.value) }))} style={selectStyle}><option value={10}>10 sec</option><option value={15}>15 sec</option><option value={20}>20 sec</option><option value={30}>30 sec</option></select></label>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px" }}>
                      <label style={labelStyle}>Tone<select value={creativeBrief.tone} onChange={(e) => setCreativeBrief((b) => ({ ...b, tone: e.target.value }))} style={selectStyle}><option>Energetic · Premium</option><option>Funny · Viral</option><option>Emotional · Cinematic</option><option>Educational · Clear</option><option>Luxury · Minimal</option><option>Authentic · UGC</option></select></label>
                      <label style={labelStyle}>Pacing<select value={creativeBrief.pacing} onChange={(e) => setCreativeBrief((b) => ({ ...b, pacing: e.target.value }))} style={selectStyle}><option>Fast</option><option>Medium</option><option>Slow / Cinematic</option></select></label>
                      <label style={labelStyle}>Hook<select value={creativeBrief.hook_priority} onChange={(e) => setCreativeBrief((b) => ({ ...b, hook_priority: e.target.value }))} style={selectStyle}><option>Visual Shock</option><option>Product Beauty</option><option>Price / Offer</option><option>Human Reaction</option><option>Curiosity</option></select></label>
                    </div>
                    <input value={creativeBrief.visual_style} onChange={(e) => setCreativeBrief((b) => ({ ...b, visual_style: e.target.value }))} placeholder="Anything specific about this Reel? Optional creative reference." style={{ ...inputStyle }} />
                  </div>
                </div>
              </div>
              <button className="primary" disabled={isBuildingScript} onClick={buildScriptAndShootingPlan}>{isBuildingScript ? <><Loader2 size={16} className="spin" /> ATLAS is writing the production plan...</> : <><Sparkles size={16} /> Build script & shooting plan <ArrowRight size={16} /></>}</button>
            </div>
          )}

          {step === 2 && (
            <div className="stage">
              <div className="stageHead"><div><span className="eyebrow">STEP 02 · MASTER DIRECTOR</span><h2>{productionPlan?.title || "Your production plan"}</h2><p>ATLAS decided what the Reel should be before asking you for footage.</p></div><Wand2 size={20} /></div>
              {productionPlan && <>
                <div className="storyCard"><div className="storyTop"><div><span>CREATIVE CONCEPT</span><strong>{productionPlan.title}</strong></div><Check size={16} /></div><p>{productionPlan.recommendation}</p><div className="directorMeta"><div><small>GOAL</small><span>{productionPlan.goal}</span></div><div><small>FORMAT</small><span>{productionPlan.format} · {productionPlan.duration_seconds}s</span></div><div><small>STYLE</small><span>{productionPlan.style}</span></div></div></div>
                <div className="scriptGrid" style={{ marginTop: "14px" }}>
                  <div><small>HOOK</small><strong>{productionPlan.script?.hook}</strong></div>
                  <div><small>SETUP</small><strong>{productionPlan.script?.setup}</strong></div>
                  <div><small>DEVELOPMENT</small><strong>{productionPlan.script?.development}</strong></div>
                  <div><small>PAYOFF</small><strong>{productionPlan.script?.payoff}</strong></div>
                  <div><small>ENDING</small><strong>{productionPlan.script?.ending}</strong></div>
                </div>
                <div className="productionPlan" style={{ marginTop: "12px" }}>
                  <div><small>VOICE / DIALOGUE</small><span>{productionPlan.script?.voiceover || "None — visual storytelling"}</span></div>
                  <div><small>AUDIO</small><span>{productionPlan.audio?.music_mood} · {productionPlan.audio?.natural_sound}</span></div>
                  <div><small>CAPTIONS</small><span>{productionPlan.captions?.enabled ? `${productionPlan.captions.style} · ${productionPlan.captions.strategy}` : "OFF"}</span></div>
                </div>

                <div style={{ marginTop: "16px", marginBottom: "10px" }}><div className="eyebrow">📹 SHOOTING CHECKLIST</div><p style={{ color: "#9aa58f", fontSize: "12px", margin: "6px 0 0" }}>These are the exact shots ATLAS needs. Film them vertically in 9:16.</p></div>
                <div className="storyList">{productionPlan.shots.map((shot,index)=><div className="storyItem" key={`${shot.number}-${shot.title}`}><span>{String(index+1).padStart(2,"0")}</span><b>{shot.title}</b><strong>{shot.duration}</strong><em>{shot.description}</em><div className="shotPlan"><span><b>ROLE:</b> {shot.role}</span><span><b>FILM:</b> {shot.instruction}</span><span><b>CAMERA:</b> {shot.camera_movement}</span><span><b>FRAMING:</b> {shot.framing}</span><span><b>WHY:</b> {shot.why}</span><span><b>AUDIO:</b> {shot.audio}</span>{shot.on_screen_text && <span><b>TEXT:</b> {shot.on_screen_text}</span>}</div></div>)}</div>
                <div className="coming" style={{ marginTop: "14px" }}><span>WHAT ATLAS NEEDS FROM YOU</span><strong>{productionPlan.shots.length} shots · {productionPlan.format}</strong><small>Film the requested shots as closely as possible. After upload, ATLAS will match the real footage to this plan instead of inventing a new story.</small></div>
              </>}
              <button className="primary" onClick={() => setStep(3)} disabled={!productionPlan}><Upload size={16} /> I have the footage → upload now <ArrowRight size={16} /></button>
              <button className="secondary" onClick={() => setStep(1)}><ArrowLeft size={15} /> Change the brief</button>
            </div>
          )}

          {step === 3 && (
            <div className="stage">
              <div className="stageHead">
                <div>
                  <span className="eyebrow">STEP 03 · UPLOAD FOOTAGE</span>
                  <h2>Give ATLAS the shots.</h2>
                  <p>Upload what you filmed from the shooting plan. ATLAS first checks every clip, then matches it against the exact shots the Director requested.</p>
                </div>
                <Upload size={20} />
              </div>

              {productionPlan && (
                <div className="requestBoard">
                  <div className="requestBoardHead">
                    <div><span>WHAT ATLAS NEEDS</span><strong>{productionPlan.shots.length} planned shots</strong></div>
                    <small>{productionPlan.format} · {productionPlan.duration_seconds}s</small>
                  </div>
                  <div className="requestGrid">
                    {productionPlan.shots.map((shot) => {
                      const match = footageMatches.find((item) => item.shot_number === shot.number);
                      return (
                        <div className={`requestShot ${match?.status === "MATCHED" ? "matched" : match?.status === "PARTIAL" ? "partial" : match?.status === "MISSING" ? "missing" : ""}`} key={shot.number}>
                          <div className="requestShotTop"><span>{shot.number}</span><b>{shot.title}</b><em>{match ? match.status : "WAITING"}</em></div>
                          <p>{shot.instruction}</p>
                          <small>{shot.framing} · {shot.camera_movement}</small>
                          {match && <div className="matchLine"><strong>{match.filename || "No match"}</strong><span>{match.confidence}% · {match.source_start.toFixed(1)}s → {match.source_end.toFixed(1)}s</span></div>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <label className="dropzone">
                <Upload size={30} />
                <strong>{clips.length ? "Add / replace footage" : "Drop videos here"}</strong>
                <span>MP4, MOV, WebM · upload all available takes</span>
                <input type="file" accept="video/*" multiple hidden onChange={addVideos} />
              </label>

              {clips.length > 0 && (
                <div className="clipGrid">
                  {clips.map((clip,index) => (
                    <div className="sourceClip" key={clip.id}>
                      <video src={clip.preview} muted playsInline />
                      <div><span>{String(index+1).padStart(2,"0")}</span><strong>{clip.filename}</strong></div>
                    </div>
                  ))}
                </div>
              )}

              {error && <div className="errorBox">{error}</div>}

              {!footageMatched ? (
                <button className="primary" disabled={isAnalyzing || !clips.length} onClick={analyzeAndPlan}>
                  {isAnalyzing ? <><Loader2 size={16} className="spin" /> {isMatching ? "ATLAS is matching your footage..." : "ATLAS is analyzing footage..."}</> : <><Sparkles size={16} /> Analyze & match footage <ArrowRight size={16} /></>}
                </button>
              ) : (
                <>
                  <div className="matchSummary">
                    <strong>ATLAS MATCH COMPLETE</strong>
                    <span>{footageMatches.filter((m) => m.status === "MATCHED").length} matched · {footageMatches.filter((m) => m.status === "PARTIAL").length} partial · {footageMatches.filter((m) => m.status === "MISSING").length} missing</span>
                  </div>
                  <button className="primary" disabled={isAnalyzing} onClick={continueToMasterEdit}>
                    {isAnalyzing ? <><Loader2 size={16} className="spin" /> Building the Master Edit...</> : <><Wand2 size={16} /> Continue to AI Edit <ArrowRight size={16} /></>}
                  </button>
                </>
              )}

              <button className="secondary" onClick={() => setStep(2)}><ArrowLeft size={15} /> Back to shooting plan</button>
            </div>
          )}
          {step === 4 && (
            <div className="stage">
              <div className="stageHead"><div><span className="eyebrow">STEP 04 · AI EDIT</span><h2>ATLAS builds the edit.</h2><p>Now the Director has the original plan and the real footage. It chooses the exact moments that execute the intended story.</p></div><Wand2 size={20} /></div>
              {masterPlan?.remake && (
                <div className="remakePanel">
                  <div className="remakeHeader">
                    <div>
                      <span className="eyebrow">ATLAS REMAKE</span>
                      <h3>Ideal → Real → Best Possible Reel</h3>
                      <p>{masterPlan.remake.summary}</p>
                    </div>
                    <span className={`remakeDecision ${masterPlan.remake.decision.toLowerCase()}`}>
                      {masterPlan.remake.decision}
                    </span>
                  </div>

                  <div className="remakeGrid">
                    <div className="remakeBlock">
                      <small>WHAT SURVIVES FROM IDEAL</small>
                      {masterPlan.remake.what_survives_from_ideal.length ? (
                        <ul>
                          {masterPlan.remake.what_survives_from_ideal.map((item, index) => (
                            <li key={`survive-${index}`}>{item}</li>
                          ))}
                        </ul>
                      ) : <span className="muted">Nothing explicitly preserved.</span>}
                    </div>

                    <div className="remakeBlock">
                      <small>WHAT CHANGED</small>
                      {masterPlan.remake.what_changed.length ? (
                        <ul>
                          {masterPlan.remake.what_changed.map((item, index) => (
                            <li key={`changed-${index}`}>{item}</li>
                          ))}
                        </ul>
                      ) : <span className="muted">No major creative changes.</span>}
                    </div>

                    <div className="remakeBlock">
                      <small>FOOTAGE STRENGTHS</small>
                      {masterPlan.remake.footage_strengths.length ? (
                        <ul>
                          {masterPlan.remake.footage_strengths.map((item, index) => (
                            <li key={`strength-${index}`}>{item}</li>
                          ))}
                        </ul>
                      ) : <span className="muted">No strengths reported.</span>}
                    </div>

                    <div className="remakeBlock warning">
                      <small>MISSING / PROBLEMS</small>
                      {[...masterPlan.remake.missing_ideal_shots, ...masterPlan.remake.footage_problems].length ? (
                        <ul>
                          {[...masterPlan.remake.missing_ideal_shots, ...masterPlan.remake.footage_problems].map((item, index) => (
                            <li key={`problem-${index}`}>{item}</li>
                          ))}
                        </ul>
                      ) : <span className="muted">No critical footage problems.</span>}
                    </div>
                  </div>

                  <div className="voicePlan">
                    <div className="voicePlanTop">
                      <div>
                        <small>VOICE PLAN</small>
                        <strong>
                          {masterPlan.remake.voice.needed
                            ? masterPlan.remake.voice.source === "USER_RECORDING"
                              ? "🎙 Record this yourself"
                              : "✨ Generate with AI voice"
                            : "No voice needed"}
                        </strong>
                      </div>
                      <span className={masterPlan.remake.voice.needed ? "voiceNeeded" : "voiceNone"}>
                        {masterPlan.remake.voice.needed ? "VOICE REQUIRED" : "VISUAL ONLY"}
                      </span>
                    </div>

                    {masterPlan.remake.voice.reason && (
                      <p>{masterPlan.remake.voice.reason}</p>
                    )}

                    {masterPlan.remake.voice.needed && masterPlan.remake.voice.script && (
                      <div className="voiceScript">
                        <div>
                          <span>WORD-FOR-WORD SCRIPT</span>
                          <button
                            type="button"
                            onClick={() => navigator.clipboard?.writeText(masterPlan.remake.voice.script)}
                          >
                            Copy
                          </button>
                        </div>
                        <strong>{masterPlan.remake.voice.script}</strong>
                      </div>
                    )}
                  </div>

                  {masterPlan.remake.voice.needed && (
                    <div className="voiceControls">
                      <div className="voiceControlsHead">
                        <div>
                          <span>MAKE THE VOICE REAL</span>
                          <strong>
                            {voiceSource === "AI_VOICE"
                              ? "✨ AI voice ready"
                              : voiceSource === "USER_RECORDING"
                                ? "🎙 Your recording ready"
                                : "Choose how the script will be spoken"}
                          </strong>
                        </div>
                        {voiceUrl && <audio src={voiceUrl} controls preload="metadata" />}
                      </div>

                      <div className="voiceChoiceGrid">
                        <button
                          type="button"
                          className={voiceSource === "USER_RECORDING" ? "voiceChoice selected" : "voiceChoice"}
                          onClick={() => {
                            setVoiceSource("USER_RECORDING");
                            setError("");
                          }}
                        >
                          <span>🎙</span>
                          <div><b>Record myself</b><small>Use your own voice</small></div>
                        </button>

                        <button
                          type="button"
                          className={voiceSource === "AI_VOICE" ? "voiceChoice selected" : "voiceChoice"}
                          onClick={generateAIVoice}
                          disabled={isGeneratingVoice}
                        >
                          <span>✨</span>
                          <div>
                            <b>{isGeneratingVoice ? "Generating..." : "Generate AI voice"}</b>
                            <small>ATLAS reads the script</small>
                          </div>
                        </button>
                      </div>

                      {voiceSource === "USER_RECORDING" && (
                        <div className="voiceRecorder">
                          <button
                            type="button"
                            className={isRecordingVoice ? "recordButton recording" : "recordButton"}
                            onClick={isRecordingVoice ? stopVoiceRecording : startVoiceRecording}
                          >
                            {isRecordingVoice ? "■ Stop recording" : "● Start recording"}
                          </button>
                          <span>
                            {isRecordingVoice
                              ? `Recording ${recordingSeconds}s…`
                              : voiceFile
                                ? "Recording saved — preview it above."
                                : "Read the word-for-word script above."}
                          </span>
                        </div>
                      )}

                      {voiceFile && (
                        <div className="voiceReadyLine">
                          <Check size={14} />
                          Voice will be baked into the render automatically.
                        </div>
                      )}
                    </div>
                  )}

                  {masterPlan.remake.revised_timeline.length > 0 && (
                    <div className="remakeTimeline">
                      <div className="timelineTitle">
                        <span>REVISED TIMELINE</span>
                        <small>Built after seeing the real footage</small>
                      </div>
                      {masterPlan.remake.revised_timeline.map((beat, index) => (
                        <div className="timelineRow" key={`${beat.beat_id}-${index}`}>
                          <span className="timelineTime">
                            {beat.start.toFixed(1)}s → {beat.end.toFixed(1)}s
                          </span>
                          <div>
                            <strong>{beat.beat_id}</strong>
                            <p>{beat.purpose}</p>
                            <small>{beat.source_filename} · {beat.reason_for_change}</small>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <button className="primary" disabled={!editPlan} onClick={() => setStep(5)}><Mic2 size={16}/> Continue to voice <ArrowRight size={16}/></button>
              <button className="secondary" onClick={() => setStep(3)}><ArrowLeft size={15}/> Back to footage</button>
            </div>
          )}

          {step === 5 && (
            <div className="stage">
              <div className="stageHead">
                <div>
                  <span className="eyebrow">STEP 05 · VOICE</span>
                  <h2>Make the script speak.</h2>
                  <p>
                    ATLAS already wrote the word-for-word script. Use your own
                    voice or let ATLAS generate the voiceover.
                  </p>
                </div>
                <Mic2 size={20} />
              </div>

              <div className="voiceScriptHero">
                <span>WORD-FOR-WORD SCRIPT</span>
                <strong>{masterPlan?.remake?.voice?.script || "No voice script yet."}</strong>
              </div>

              <div className="voiceControls">
                <div className="voiceControlsHead">
                  <div>
                    <span>VOICE SOURCE</span>
                    <strong>
                      {voiceSource === "AI_VOICE"
                        ? "✨ AI voice ready"
                        : voiceSource === "USER_RECORDING"
                          ? "🎙 Your recording ready"
                          : "Choose how the script will be spoken"}
                    </strong>
                  </div>
                  {voiceUrl && <audio src={voiceUrl} controls preload="metadata" />}
                </div>

                <div className="voiceChoiceGrid">
                  <button
                    type="button"
                    className={voiceSource === "USER_RECORDING" ? "voiceChoice selected" : "voiceChoice"}
                    onClick={() => {
                      setVoiceSource("USER_RECORDING");
                      setError("");
                    }}
                  >
                    <span>🎙</span>
                    <div><b>Record myself</b><small>Use your own voice</small></div>
                  </button>

                  <button
                    type="button"
                    className={voiceSource === "AI_VOICE" ? "voiceChoice selected" : "voiceChoice"}
                    onClick={generateAIVoice}
                    disabled={isGeneratingVoice}
                  >
                    <span>✨</span>
                    <div>
                      <b>{isGeneratingVoice ? "Generating..." : "Generate AI voice"}</b>
                      <small>ATLAS reads the script</small>
                    </div>
                  </button>
                </div>

                {voiceSource === "USER_RECORDING" && (
                  <div className="voiceRecorder">
                    <button
                      type="button"
                      className={isRecordingVoice ? "recordButton recording" : "recordButton"}
                      onClick={isRecordingVoice ? stopVoiceRecording : startVoiceRecording}
                    >
                      {isRecordingVoice ? "■ Stop recording" : "● Start recording"}
                    </button>
                    <span>
                      {isRecordingVoice
                        ? `Recording ${recordingSeconds}s…`
                        : voiceFile
                          ? "Recording saved — preview it above."
                          : "Read the word-for-word script above."}
                    </span>
                  </div>
                )}

                {voiceFile && (
                  <div className="voiceReadyLine">
                    <Check size={14} />
                    Voice will be baked into the render automatically.
                  </div>
                )}
              </div>

              <button
                className="primary"
                disabled={isRendering || !editPlan || !voiceFile}
                onClick={renderEditPreview}
              >
                {isRendering
                  ? <><Loader2 size={16} className="spin"/> Building edit with voice...</>
                  : <><Film size={16}/> Build edit + voice <ArrowRight size={16}/></>}
              </button>

              <button className="secondary" onClick={() => setStep(4)}>
                <ArrowLeft size={15}/> Back to AI edit
              </button>
            </div>
          )}

          {step === 8 && (
            <div className="stage">
              <div className="stageHead"><div><span className="eyebrow">STEP 06 · PREVIEW</span><h2>Watch the edit.</h2><p>This is the first real ATLAS cut. Check the story and pacing before adding music and captions.</p></div><Play size={20}/></div>
              <div className="phone">{renderedUrl ? <video src={renderedUrl} controls autoPlay playsInline/> : <div className="emptyPhone">No preview yet.</div>}</div>
              <div className="previewMeta"><span>AI CUT</span><strong>{editPlan?.totalDuration || 0}s · 9:16</strong></div>
              <div className="finalCard" style={{ marginTop: 14 }}>
                <div>
                  <span>{isSelfEditing ? "ATLAS SELF-EDITING" : "ATLAS QUALITY GATE"}</span>
                  <strong>{isSelfEditing ? "Reviewing → fixing → re-rendering" : selfReview ? `Score ${selfReview.overall_score}/100 · ${selfReview.verdict}` : "Render → review → improve"}</strong>
                  {selfReview?.summary && <small>{selfReview.summary}</small>}
                </div>
                {isSelfEditing ? <Loader2 size={18} className="spin" /> : <Sparkles size={18} />}
              </div>
              <button className="primary" onClick={() => setStep(7)}><Music2 size={16}/> Keep this cut · choose music <ArrowRight size={16}/></button>
              <button className="secondary" onClick={() => setStep(4)}><ArrowLeft size={15}/> Change the edit</button>
            </div>
          )}

          {step === 6 && (
            <div className="stage">
              <div className="stageHead">
                <div>
                  <span className="eyebrow">
                    STEP 07
                  </span>
                  <h2>
                    Give it a soundtrack
                  </h2>
                  <p>
                    Pick the energy. ATLAS will use
                    this track for the final render.
                  </p>
                </div>

                <Music2 size={20} />
              </div>

              <div className="phone small">
                {renderedUrl ? (
                  <video
                    src={renderedUrl}
                    controls
                    playsInline
                  />
                ) : null}
              </div>

              <div className="musicNow">
                <div>
                  <span>
                    SELECTED TRACK
                  </span>
                  <strong>
                    {musicFile?.name ||
                      `ATLAS ${musicMood}`}
                  </strong>
                </div>

                {musicUrl ? (
                  <audio
                    src={musicUrl}
                    controls
                    preload="metadata"
                  />
                ) : null}
              </div>

              <div className="choiceGrid">
                {[
                  {
                    mood: "Energetic",
                    file: "/music/atlas-energetic.wav",
                    label: "Fast / punchy",
                  },
                  {
                    mood: "Premium",
                    file: "/music/atlas-premium.wav",
                    label: "Clean / cinematic",
                  },
                  {
                    mood: "Chill",
                    file: "/music/atlas-chill.wav",
                    label: "Smooth / relaxed",
                  },
                ].map((track) => (
                  <button
                    key={track.mood}
                    className={
                      musicMood === track.mood
                        ? "choice selected"
                        : "choice"
                    }
                    onClick={() => {
                      setMusicMood(track.mood);
                      setMusicFile(null);
                      setMusicUrl(track.file);
                      setMusicApplied(false);
                      setFinalReady(false);
                    }}
                  >
                    <Music2 size={16} />
                    <span>
                      <b>{track.mood}</b>
                      <small>{track.label}</small>
                    </span>
                    {musicMood === track.mood && (
                      <Check size={14} />
                    )}
                  </button>
                ))}
              </div>

              <label className="musicUpload">
                <Upload size={16} />
                <span>
                  <strong>Use your own track</strong>
                  <small>MP3, WAV, M4A</small>
                </span>
                <input
                  type="file"
                  accept="audio/*"
                  hidden
                  onChange={(event) => {
                    const file =
                      event.target.files?.[0];

                    if (!file) return;

                    if (musicUrl) {
                      URL.revokeObjectURL(musicUrl);
                    }

                    const url =
                      URL.createObjectURL(file);

                    setMusicFile(file);
                    setMusicUrl(url);
                    setMusicMood("Custom");
                    setMusicApplied(false);
                    setFinalReady(false);
                  }}
                />
                <ArrowRight size={15} />
              </label>

              <div className="coming">
                <span>
                  AUDIO ENGINE
                </span>
                <strong>
                  {musicFile
                    ? "CUSTOM TRACK READY"
                    : `${musicMood.toUpperCase()} TRACK READY`}
                </strong>
                <small>
                  The selected track is ready for the
                  final mix. We will wire it into FFmpeg
                  in the next step.
                </small>
              </div>

              {!musicApplied ? (
                <button
                  className="primary"
                  onClick={applyMusic}
                  disabled={isApplyingMusic}
                >
                  {isApplyingMusic
                    ? "Mixing music..."
                    : "Apply music & preview"}
                  {isApplyingMusic ? (
                    <Loader2 size={15} className="spin" />
                  ) : (
                    <ArrowRight size={16} />
                  )}
                </button>
              ) : (
                <button
                  className="primary"
                  onClick={() => setStep(7)}
                >
                  Music preview ready · continue
                  <ArrowRight size={16} />
                </button>
              )}

              <button
                className="secondary"
                onClick={() => setStep(5)}
              >
                <ArrowLeft size={15} />
                Back to preview
              </button>
            </div>
          )}

          {step === 7 && (
            <div className="stage">
              <div className="stageHead">
                <div>
                  <span className="eyebrow">
                    STEP 08
                  </span>
                  <h2>
                    Make the words hit.
                  </h2>
                  <p>
                    ATLAS transcribes the real audio,
                    then you choose the caption style.
                  </p>
                </div>

                <Subtitles size={20} />
              </div>

              <div className="phone small">
                {renderedUrl ? (
                  <video
                    src={renderedUrl}
                    controls
                    playsInline
                  />
                ) : null}
              </div>

              {!captionsReady ? (
                <div className="captionGenerate">
                  <div className="captionGenerateIcon">
                    <Subtitles size={20} />
                  </div>

                  <strong>
                    Generate captions
                  </strong>

                  <p>
                    ATLAS will transcribe the uploaded
                    clips and prepare timed caption segments.
                  </p>

                  <button
                    className="primary"
                    onClick={generateCaptions}
                    disabled={isGeneratingCaptions}
                  >
                    {isGeneratingCaptions
                      ? "Transcribing..."
                      : "Generate captions"}
                    <ArrowRight size={15} />
                  </button>
                </div>
              ) : (
                <>
                  <div className="captionReady">
                    <Check size={15} />
                    <span>
                      {captions.length} caption segments ready
                    </span>
                  </div>

                  <div className="captionList">
                    {captions
                      .slice(0, 8)
                      .map((caption, index) => (
                        <div
                          className="captionRow"
                          key={`${caption.filename}-${index}`}
                        >
                          <span>
                            {caption.start.toFixed(1)}s
                          </span>
                          <strong>
                            {caption.text}
                          </strong>
                        </div>
                      ))}
                  </div>

                  <div className="captionLabel">
                    CAPTION STYLE
                  </div>

                  <div className="choiceGrid">
                    {[
                      ["Bold", "Big / high impact"],
                      ["Minimal", "Clean / subtle"],
                      ["Highlight", "Key words pop"],
                      ["Kinetic", "Fast / dynamic"],
                    ].map(([style, desc]) => (
                      <button
                        key={style}
                        className={
                          captionStyle === style
                            ? "choice selected"
                            : "choice"
                        }
                        onClick={() =>
                          setCaptionStyle(style)
                        }
                      >
                        <Subtitles size={16} />
                        <span>
                          <b>{style}</b>
                          <small>{desc}</small>
                        </span>
                        {captionStyle === style && (
                          <Check size={14} />
                        )}
                      </button>
                    ))}
                  </div>

                  <div className="finalCard">
                    <div>
                      <span>FINAL SETUP</span>
                      <strong>
                        {musicMood} · {captionStyle}
                      </strong>
                    </div>
                    <Check size={18} />
                  </div>

                  <div className="coming">
                    <span>FINAL RENDER</span>
                    <strong>
                      {finalReady
                        ? "FINAL REEL READY"
                        : "MUSIC + CAPTIONS READY"}
                    </strong>
                    <small>
                      {finalReady
                        ? "The selected music and captions are now baked into the MP4."
                        : "ATLAS will now render the selected music and caption style into the final MP4."}
                    </small>
                  </div>

                  <button
                    className="primary"
                    onClick={renderFinalReel}
                    disabled={isFinalRendering}
                  >
                    {isFinalRendering
                      ? "Rendering final Reel..."
                      : finalReady
                        ? "Render again"
                        : "Render final Reel"}
                    {isFinalRendering ? (
                      <Loader2 size={15} className="spin" />
                    ) : (
                      <Sparkles size={15} />
                    )}
                  </button>

                  {finalReady && renderedUrl && (
                    <a
                      className="primary linkButton"
                      href={renderedUrl}
                      download="atlas-final-reel.mp4"
                    >
                      <Download size={16} />
                      Export final MP4
                    </a>
                  )}

                  <button
                    className="secondary"
                    onClick={generateCaptions}
                    disabled={isGeneratingCaptions}
                  >
                    {isGeneratingCaptions
                      ? "Transcribing..."
                      : "Regenerate captions"}
                  </button>
                </>
              )}

              <button
                className="secondary"
                onClick={() => setStep(6)}
              >
                <ArrowLeft size={15} />
                Back to music
              </button>
            </div>
          )}
        </div>

        <aside className="side">
          <div className="sideLabel">
            NOW
          </div>

          <div className="nowCard">
            <span className="nowIcon">
              {step === 1 && <Sparkles size={17} />}
              {step === 2 && <Wand2 size={17} />}
              {step === 3 && <Upload size={17} />}
              {step === 4 && <Wand2 size={17} />}
              {step === 5 && <Mic2 size={17} />}
              {step === 6 && <Play size={17} />}
              {step === 7 && <Music2 size={17} />}
              {step === 8 && <Subtitles size={17} />}
            </span>

            <strong>
              {currentStep.label}
            </strong>

            <p>
              {currentStep.description}
            </p>
          </div>

          <div className="sideLabel">
            ATLAS STATUS
          </div>

          <div className="statusList">
            <div>
              <Check size={13} />
              <span>Upload pipeline</span>
            </div>
            <div>
              <Check size={13} />
              <span>Vision analysis</span>
            </div>
            <div>
              <Check size={13} />
              <span>AI story edit</span>
            </div>
            <div
              className={
                step >= 5
                  ? "ready"
                  : ""
              }
            >
              {step >= 5 ? (
                <Check size={13} />
              ) : (
                <i />
              )}
              <span>Real preview</span>
            </div>
          </div>

          {error && (
            <div className="error">
              {error}
            </div>
          )}
        </aside>
      </section>

      <style jsx global>{`
        * {
          box-sizing: border-box;
        }

        body {
          margin: 0;
          background: #070809;
          color: #edf1ea;
          font-family:
            Inter, Arial, sans-serif;
        }

        button,
        input {
          font: inherit;
        }

        button,
        label {
          cursor: pointer;
        }

        .atlas {
          min-height: 100vh;
          background:
            radial-gradient(
              circle at 50% -15%,
              #172016 0,
              transparent 42%
            ),
            #070809;
          padding-bottom: 80px;
        }

        .topbar {
          height: 66px;
          padding: 0 30px;
          border-bottom: 1px solid #20241f;
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: #090a0b;
        }

        .brand {
          display: flex;
          align-items: center;
          gap: 7px;
          font-size: 12px;
          font-weight: 900;
          letter-spacing: .05em;
        }

        .brand span {
          width: 25px;
          height: 25px;
          display: grid;
          place-items: center;
          border: 1px solid #30362c;
          border-radius: 7px;
          color: #c9ff4a;
        }

        .brand b {
          color: #687069;
          font-weight: 600;
        }

        .topStatus {
          color: #9ba491;
          font-size: 10px;
          display: flex;
          align-items: center;
          gap: 7px;
        }

        .topStatus i {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #c9ff4a;
          box-shadow: 0 0 12px #c9ff4a;
        }

        .download,
        .reset {
          border: 1px solid #c9ff4a;
          background: transparent;
          color: #c9ff4a;
          padding: 9px 13px;
          border-radius: 8px;
          font-size: 10px;
          font-weight: 800;
          text-decoration: none;
        }

        .hero {
          max-width: 1180px;
          margin: auto;
          padding: 58px 30px 30px;
        }

        .eyebrow {
          display: block;
          color: #707871;
          font-size: 8px;
          font-weight: 900;
          letter-spacing: .18em;
        }

        .hero h1 {
          margin: 10px 0;
          font-size: clamp(34px, 5vw, 62px);
          line-height: .95;
          letter-spacing: -.055em;
        }

        .hero h1 em {
          color: #c9ff4a;
          font-style: normal;
        }

        .hero p {
          max-width: 520px;
          color: #7d847e;
          line-height: 1.7;
          font-size: 13px;
        }

        .steps {
          max-width: 1180px;
          margin: 0 auto 24px;
          padding: 0 30px;
          display: grid;
          grid-template-columns:
            repeat(5, 1fr);
          gap: 8px;
        }

        .step {
          border: 1px solid #222722;
          background: #0b0d0c;
          color: #777f77;
          border-radius: 10px;
          padding: 11px;
          display: flex;
          align-items: center;
          gap: 9px;
          text-align: left;
        }

        .step.active {
          border-color: #c9ff4a;
          color: #eef5e8;
          background: #11160e;
        }

        .step.done {
          color: #a5b29a;
          border-color: #30382b;
        }

        .stepNumber {
          width: 25px;
          height: 25px;
          flex: 0 0 25px;
          border-radius: 7px;
          border: 1px solid #30362f;
          display: grid;
          place-items: center;
          font-size: 9px;
          font-weight: 900;
        }

        .step.active .stepNumber {
          background: #c9ff4a;
          color: #080a06;
          border-color: #c9ff4a;
        }

        .step strong,
        .step small {
          display: block;
        }

        .step strong {
          font-size: 10px;
        }

        .step small {
          margin-top: 2px;
          font-size: 8px;
          color: #656c66;
        }

        .workspace {
          max-width: 1180px;
          margin: auto;
          padding: 0 30px;
          display: grid;
          grid-template-columns:
            minmax(0, 1fr) 260px;
          gap: 18px;
        }

        .mainCard {
          border: 1px solid #222722;
          background: #0b0d0c;
          border-radius: 14px;
          min-height: 620px;
        }

        .stage {
          padding: 28px;
        }

        .stageHead {
          display: flex;
          justify-content: space-between;
          gap: 20px;
          margin-bottom: 25px;
        }

        .stageHead > svg {
          color: #c9ff4a;
        }

        .stage h2 {
          margin: 8px 0 7px;
          font-size: 25px;
          letter-spacing: -.035em;
        }

        .stage p {
          color: #737b74;
          font-size: 11px;
          line-height: 1.6;
        }

        .dropzone {
          min-height: 230px;
          border: 1px dashed #343a34;
          border-radius: 13px;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          gap: 10px;
          color: #687069;
          background:
            radial-gradient(
              circle,
              #11150f 0,
              transparent 65%
            );
        }

        .dropzone svg {
          color: #c9ff4a;
        }

        .dropzone strong {
          color: #e8eee4;
          font-size: 14px;
        }

        .dropzone span {
          font-size: 9px;
        }

        .clipGrid {
          margin-top: 15px;
          display: grid;
          grid-template-columns:
            repeat(
              auto-fit,
              minmax(160px, 1fr)
            );
          gap: 9px;
        }

        .sourceClip {
          border: 1px solid #252a25;
          border-radius: 9px;
          overflow: hidden;
          background: #080908;
        }

        .sourceClip video {
          width: 100%;
          aspect-ratio: 16/9;
          object-fit: cover;
          display: block;
        }

        .sourceClip div {
          padding: 8px;
          display: flex;
          gap: 7px;
          align-items: center;
        }

        .sourceClip span {
          color: #c9ff4a;
          font-size: 8px;
          font-weight: 900;
        }

        .sourceClip strong {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: #9ca39c;
          font-size: 8px;
        }

        .primary {
          margin-top: 22px;
          width: 100%;
          border: 0;
          background: #c9ff4a;
          color: #080a06;
          padding: 13px 16px;
          border-radius: 9px;
          font-size: 10px;
          font-weight: 900;
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 8px;
          text-decoration: none;
        }

        .primary:disabled {
          opacity: .45;
          cursor: wait;
        }

        .secondary {
          margin-top: 9px;
          width: 100%;
          border: 1px solid #292e29;
          background: transparent;
          color: #858d85;
          padding: 11px 14px;
          border-radius: 9px;
          font-size: 9px;
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 7px;
        }

        .remakePanel {
          margin-bottom: 14px;
          border: 1px solid rgba(201,255,74,.22);
          border-radius: 14px;
          padding: 15px;
          background:
            radial-gradient(circle at 100% 0%, rgba(201,255,74,.08), transparent 38%),
            #0d110d;
        }

        .remakeHeader {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 14px;
        }

        .remakeHeader h3 {
          margin: 7px 0 4px;
          font-size: 17px;
          letter-spacing: -.025em;
        }

        .remakeHeader p {
          margin: 0;
          max-width: 700px;
          color: #8d968c;
          font-size: 10px;
          line-height: 1.5;
        }

        .remakeDecision {
          flex: 0 0 auto;
          border: 1px solid #39422f;
          border-radius: 999px;
          padding: 7px 10px;
          font-size: 8px;
          font-weight: 900;
          letter-spacing: .1em;
        }

        .remakeDecision.keep {
          color: #c9ff4a;
          border-color: rgba(201,255,74,.35);
          background: rgba(201,255,74,.06);
        }

        .remakeDecision.adapt {
          color: #ffd27a;
          border-color: rgba(255,210,122,.28);
          background: rgba(255,210,122,.05);
        }

        .remakeDecision.rebuild {
          color: #ff9c90;
          border-color: rgba(255,100,90,.28);
          background: rgba(255,100,90,.05);
        }

        .remakeGrid {
          margin-top: 12px;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
        }

        .remakeBlock {
          border: 1px solid #232a22;
          border-radius: 9px;
          padding: 10px;
          background: #0a0d0a;
        }

        .remakeBlock.warning {
          border-color: rgba(255,170,90,.18);
        }

        .remakeBlock > small,
        .voicePlanTop small,
        .voiceScript span,
        .timelineTitle span {
          display: block;
          color: #697368;
          font-size: 7px;
          letter-spacing: .14em;
          font-weight: 900;
        }

        .remakeBlock ul {
          margin: 7px 0 0;
          padding-left: 15px;
        }

        .remakeBlock li {
          color: #b7c0b5;
          font-size: 9px;
          line-height: 1.45;
          margin: 3px 0;
        }

        .muted {
          display: block;
          margin-top: 7px;
          color: #596259;
          font-size: 8px;
        }

        .voicePlan {
          margin-top: 10px;
          border: 1px solid rgba(201,255,74,.16);
          border-radius: 10px;
          padding: 11px;
          background: rgba(201,255,74,.025);
        }

        .voicePlanTop {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }

        .voicePlanTop strong {
          display: block;
          margin-top: 4px;
          color: #eef5e8;
          font-size: 12px;
        }

        .voiceNeeded,
        .voiceNone {
          font-size: 7px;
          letter-spacing: .1em;
          font-weight: 900;
          padding: 6px 8px;
          border-radius: 999px;
        }

        .voiceNeeded {
          color: #c9ff4a;
          border: 1px solid rgba(201,255,74,.3);
          background: rgba(201,255,74,.05);
        }

        .voiceNone {
          color: #7d877d;
          border: 1px solid #2b312b;
        }

        .voicePlan > p {
          margin: 7px 0 0;
          color: #778177;
          font-size: 9px;
          line-height: 1.45;
        }

        .voiceScript {
          margin-top: 9px;
          border: 1px solid #2b3428;
          border-radius: 9px;
          padding: 10px;
          background: #090c09;
        }

        .voiceScript > div {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }

        .voiceScript button {
          border: 1px solid #30382e;
          background: #11150f;
          color: #aeb9a7;
          border-radius: 6px;
          padding: 4px 7px;
          font-size: 7px;
        }

        .voiceScript strong {
          display: block;
          margin-top: 7px;
          color: #e8eee4;
          font-size: 11px;
          line-height: 1.5;
          font-weight: 650;
        }

        .voiceScriptHero {
          margin-bottom: 10px;
          padding: 12px;
          border: 1px solid rgba(201,255,74,.18);
          border-radius: 10px;
          background: rgba(201,255,74,.025);
        }
        .voiceScriptHero span {
          display: block;
          color: #697368;
          font-size: 7px;
          letter-spacing: .14em;
          font-weight: 900;
          margin-bottom: 6px;
        }
        .voiceScriptHero strong {
          display: block;
          color: #eef5e8;
          font-size: 10px;
          line-height: 1.55;
        }

        .voiceControls {
          margin-top: 10px;
          border: 1px solid rgba(201,255,74,.18);
          border-radius: 10px;
          padding: 11px;
          background: rgba(201,255,74,.025);
        }
        .voiceControlsHead {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }
        .voiceControlsHead > div > span {
          display: block;
          color: #697368;
          font-size: 7px;
          letter-spacing: .14em;
          font-weight: 900;
        }
        .voiceControlsHead strong {
          display: block;
          margin-top: 4px;
          color: #eef5e8;
          font-size: 11px;
        }
        .voiceControlsHead audio { width: 190px; height: 30px; }
        .voiceChoiceGrid {
          margin-top: 9px;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
        }
        .voiceChoice {
          border: 1px solid #293029;
          background: #0a0d0a;
          color: #b8c1b5;
          border-radius: 8px;
          padding: 9px;
          display: flex;
          align-items: center;
          gap: 8px;
          text-align: left;
        }
        .voiceChoice.selected {
          border-color: #c9ff4a;
          background: rgba(201,255,74,.06);
          color: #eff5eb;
        }
        .voiceChoice > span { font-size: 15px; }
        .voiceChoice b, .voiceChoice small { display: block; }
        .voiceChoice b { font-size: 9px; }
        .voiceChoice small { margin-top: 2px; color: #667067; font-size: 7px; }
        .voiceRecorder {
          margin-top: 8px;
          display: flex;
          align-items: center;
          gap: 9px;
          padding: 8px;
          border: 1px solid #232a22;
          border-radius: 8px;
          background: #090c09;
        }
        .recordButton {
          border: 1px solid #c9ff4a;
          background: transparent;
          color: #c9ff4a;
          border-radius: 7px;
          padding: 7px 9px;
          font-size: 8px;
          font-weight: 900;
        }
        .recordButton.recording { border-color: #ff756b; color: #ff9b93; }
        .voiceRecorder > span { color: #717a70; font-size: 8px; }
        .voiceReadyLine {
          margin-top: 8px;
          display: flex;
          align-items: center;
          gap: 6px;
          color: #a9b69f;
          font-size: 8px;
        }

        .remakeTimeline {
          margin-top: 10px;
          border: 1px solid #232a22;
          border-radius: 10px;
          padding: 10px;
          background: #090c09;
        }

        .timelineTitle {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          align-items: center;
          margin-bottom: 7px;
        }

        .timelineTitle small {
          color: #5f685f;
          font-size: 7px;
        }

        .timelineRow {
          display: grid;
          grid-template-columns: 92px 1fr;
          gap: 10px;
          padding: 8px 0;
          border-top: 1px solid #1b211b;
        }

        .timelineRow:first-of-type {
          border-top: 0;
        }

        .timelineTime {
          color: #c9ff4a;
          font-size: 8px;
          font-weight: 800;
        }

        .timelineRow strong {
          color: #dce4d9;
          font-size: 9px;
        }

        .timelineRow p {
          margin: 3px 0;
          color: #8d978c;
          font-size: 8px;
          line-height: 1.4;
        }

        .timelineRow small {
          color: #5d665d;
          font-size: 7px;
        }

        .storyCard,
        .finalCard,
        .coming {
          border: 1px solid #292f28;
          border-radius: 11px;
          background: #0e110d;
          padding: 15px;
        }

        .storyTop {
          display: flex;
          justify-content: space-between;
        }

        .storyTop span,
        .storyTop strong {
          display: block;
        }

        .storyTop span {
          color: #6f786d;
          font-size: 8px;
          letter-spacing: .13em;
        }

        .storyTop strong {
          margin-top: 5px;
          font-size: 12px;
        }

        .storyTop svg {
          color: #c9ff4a;
        }

        .storyList {
          margin-top: 13px;
          display: grid;
          gap: 6px;
        }

        .storyItem {
          display: grid;
          grid-template-columns:
            25px 55px 1fr auto;
          gap: 8px;
          align-items: center;
          padding: 9px;
          background: #090b09;
          border-radius: 7px;
        }

        .storyItem span {
          color: #5e665e;
          font-size: 8px;
        }

        .storyItem b {
          color: #c9ff4a;
          font-size: 8px;
        }

        .storyItem strong {
          font-size: 9px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .storyItem small {
          color: #666e67;
          font-size: 8px;
        }

        .directorMeta {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
          margin: 12px 0;
        }

        .directorMeta > div {
          border: 1px solid #242b22;
          background: #0c0f0c;
          border-radius: 10px;
          padding: 10px;
        }

        .directorMeta small {
          display: block;
          color: #778173;
          font-size: 8px;
          letter-spacing: .12em;
          margin-bottom: 5px;
        }

        .directorMeta span {
          color: #d8ded4;
          font-size: 11px;
          line-height: 1.45;
        }

        .storyItem em {
          grid-column: 2 / -1;
          color: #7e897a;
          font-size: 9px;
          line-height: 1.35;
          font-style: normal;
        }

        .analysisMini {
          display: grid;
          grid-template-columns:
            repeat(
              auto-fit,
              minmax(130px, 1fr)
            );
          gap: 7px;
          margin-top: 10px;
        }

        .analysisMini div {
          border: 1px solid #222722;
          padding: 9px;
          border-radius: 8px;
        }

        .analysisMini b {
          color: #c9ff4a;
          margin-right: 6px;
        }

        .analysisMini span {
          color: #7b837b;
          font-size: 8px;
          text-transform: uppercase;
        }

        .analysisMini small {
          display: block;
          color: #4f5650;
          margin-top: 5px;
          font-size: 7px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .phone {
          width: min(300px, 75vw);
          margin: 0 auto;
          aspect-ratio: 9/16;
          background: #000;
          border-radius: 22px;
          overflow: hidden;
          border: 1px solid #30362f;
          box-shadow:
            0 25px 70px
            rgba(0,0,0,.45);
        }

        .phone.small {
          width: min(240px, 65vw);
        }

        .phone video {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .emptyPhone {
          height: 100%;
          display: grid;
          place-items: center;
          color: #555d56;
          font-size: 10px;
        }

        .previewMeta {
          max-width: 300px;
          margin: 12px auto 0;
          display: flex;
          justify-content: space-between;
          color: #626a62;
          font-size: 8px;
        }

        .previewMeta strong {
          color: #9ca59a;
        }

        .choiceGrid {
          display: grid;
          grid-template-columns:
            repeat(2, 1fr);
          gap: 8px;
          margin-top: 18px;
        }

        .choice {
          border: 1px solid #292e29;
          background: #0d100d;
          color: #858d85;
          padding: 14px;
          border-radius: 9px;
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 10px;
        }

        .choice svg:last-child {
          margin-left: auto;
        }

        .choice.selected {
          border-color: #c9ff4a;
          color: #e8eee4;
          background: #11160e;
        }

        .choice.selected svg:last-child {
          color: #c9ff4a;
        }

        .captionGenerate {
          margin-top: 14px;
          border: 1px solid #2c332a;
          border-radius: 12px;
          background: #0d110d;
          padding: 15px;
        }

        .captionGenerateIcon {
          width: 38px;
          height: 38px;
          border-radius: 10px;
          display: grid;
          place-items: center;
          background: #c9ff4a;
          color: #10130f;
          margin-bottom: 11px;
        }

        .captionGenerate strong {
          font-size: 12px;
        }

        .captionGenerate p {
          margin: 5px 0 12px;
          color: #687168;
          font-size: 8px;
          line-height: 1.5;
        }

        .captionReady {
          margin-top: 13px;
          display: flex;
          align-items: center;
          gap: 7px;
          color: #c9ff4a;
          font-size: 9px;
        }

        .captionList {
          margin-top: 10px;
          max-height: 180px;
          overflow: auto;
          border: 1px solid #252b24;
          border-radius: 10px;
          background: #0b0e0b;
        }

        .captionRow {
          display: grid;
          grid-template-columns: 38px 1fr;
          gap: 8px;
          padding: 9px 10px;
          border-bottom: 1px solid #1d221d;
        }

        .captionRow:last-child {
          border-bottom: 0;
        }

        .captionRow span {
          color: #5e665f;
          font-size: 7px;
        }

        .captionRow strong {
          color: #cfd6ce;
          font-size: 8px;
          line-height: 1.35;
        }

        .captionLabel {
          margin-top: 14px;
          color: #606960;
          font-size: 7px;
          letter-spacing: .14em;
        }

        .musicNow {
          margin-top: 15px;
          border: 1px solid #292f28;
          border-radius: 11px;
          background: #0e110d;
          padding: 13px;
        }

        .musicNow > div span,
        .musicNow > div strong {
          display: block;
        }

        .musicNow > div span {
          color: #626a62;
          font-size: 7px;
          letter-spacing: .14em;
        }

        .musicNow > div strong {
          margin-top: 4px;
          font-size: 10px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .musicNow audio {
          width: 100%;
          height: 34px;
          margin-top: 10px;
        }

        .choice span {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 2px;
        }

        .choice span b {
          font-size: 10px;
        }

        .choice span small {
          color: #646d65;
          font-size: 7px;
        }

        .requestBoard {
          border: 1px solid rgba(180,255,80,.14);
          border-radius: 14px;
          padding: 14px;
          background: rgba(180,255,80,.025);
          margin-bottom: 14px;
        }
        .requestBoardHead { display:flex; justify-content:space-between; gap:12px; align-items:flex-end; margin-bottom:12px; }
        .requestBoardHead > div { display:grid; gap:3px; }
        .requestBoardHead span { font-size:10px; letter-spacing:.16em; color:#89928b; }
        .requestBoardHead strong { font-size:16px; color:#f5f6f8; }
        .requestBoardHead small { color:#89928b; }
        .requestGrid { display:grid; gap:8px; }
        .requestShot { border:1px solid #202522; border-radius:11px; padding:11px; background:#0b0d0f; }
        .requestShot.matched { border-color:rgba(180,255,80,.28); }
        .requestShot.partial { border-color:rgba(255,190,70,.28); }
        .requestShot.missing { border-color:rgba(255,90,70,.28); }
        .requestShotTop { display:grid; grid-template-columns:auto 1fr auto; gap:9px; align-items:center; }
        .requestShotTop span { color:#c9ff4a; font-size:10px; }
        .requestShotTop b { font-size:12px; }
        .requestShotTop em { font-style:normal; font-size:9px; letter-spacing:.08em; color:#89928b; }
        .requestShot p { margin:7px 0; color:#b4bbb5; font-size:11px; line-height:1.45; }
        .requestShot small { color:#6f7971; font-size:10px; }
        .matchLine { margin-top:8px; padding-top:8px; border-top:1px solid #1b201d; display:flex; justify-content:space-between; gap:10px; font-size:10px; }
        .matchLine strong { color:#c9ff4a; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .matchLine span { color:#89928b; white-space:nowrap; }
        .matchSummary { display:flex; justify-content:space-between; align-items:center; gap:12px; padding:11px 13px; margin:10px 0; border:1px solid rgba(180,255,80,.18); border-radius:10px; background:rgba(180,255,80,.04); }
        .matchSummary strong { color:#c9ff4a; font-size:11px; letter-spacing:.08em; }
        .matchSummary span { color:#a7afa8; font-size:11px; }
        .errorBox { margin:10px 0; padding:10px 12px; border:1px solid rgba(255,80,60,.35); border-radius:10px; color:#ff9c90; background:rgba(255,60,40,.06); font-size:11px; }
        .musicUpload {
          margin-top: 9px;
          border: 1px dashed #343a34;
          border-radius: 9px;
          padding: 12px;
          display: flex;
          align-items: center;
          gap: 9px;
          color: #899189;
        }

        .musicUpload > svg:first-child {
          color: #c9ff4a;
        }

        .musicUpload span {
          display: flex;
          flex-direction: column;
          gap: 2px;
          flex: 1;
        }

        .musicUpload strong {
          color: #dce3d8;
          font-size: 9px;
        }

        .musicUpload small {
          color: #5f675f;
          font-size: 7px;
        }

        .musicUpload > svg:last-child {
          color: #646c65;
        }

        .coming {
          margin-top: 12px;
        }

        .coming span,
        .coming strong,
        .coming small {
          display: block;
        }

        .coming span {
          color: #626a62;
          font-size: 7px;
          letter-spacing: .14em;
        }

        .coming strong {
          margin-top: 4px;
          color: #c9ff4a;
          font-size: 12px;
        }

        .coming small {
          margin-top: 4px;
          color: #666e67;
          font-size: 8px;
        }

        .finalCard {
          margin-top: 15px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .finalCard span,
        .finalCard strong {
          display: block;
        }

        .finalCard span {
          color: #626a62;
          font-size: 7px;
        }

        .finalCard strong {
          margin-top: 5px;
          font-size: 11px;
        }

        .finalCard svg {
          color: #c9ff4a;
        }

        .linkButton {
          margin-top: 12px;
        }

        .side {
          display: flex;
          flex-direction: column;
          gap: 9px;
        }

        .sideLabel {
          color: #59615a;
          font-size: 7px;
          letter-spacing: .16em;
          font-weight: 900;
          margin-top: 5px;
        }

        .nowCard {
          border: 1px solid #292e29;
          background: #0b0d0b;
          border-radius: 11px;
          padding: 15px;
        }

        .nowIcon {
          width: 30px;
          height: 30px;
          display: grid;
          place-items: center;
          background: #151b11;
          border-radius: 8px;
          color: #c9ff4a;
        }

        .nowCard strong {
          display: block;
          margin-top: 11px;
          font-size: 13px;
        }

        .nowCard p {
          color: #687068;
          font-size: 9px;
          margin: 4px 0 0;
        }

        .statusList {
          border: 1px solid #222722;
          border-radius: 10px;
          padding: 8px;
          background: #0a0c0a;
        }

        .statusList div {
          display: flex;
          gap: 7px;
          align-items: center;
          padding: 8px 6px;
          color: #5f675f;
          font-size: 8px;
        }

        .statusList svg {
          color: #7d8875;
        }

        .statusList .ready {
          color: #aeb8a6;
        }

        .statusList .ready svg {
          color: #c9ff4a;
        }

        .statusList i {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: #3c423c;
        }

        .error {
          border: 1px solid #5b302d;
          background: #241311;
          color: #ff8e84;
          padding: 11px;
          border-radius: 9px;
          font-size: 8px;
          line-height: 1.5;
        }

        .spin {
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }

        @media (max-width: 850px) {
          .steps {
            grid-template-columns:
              repeat(5, minmax(95px, 1fr));
            overflow-x: auto;
          }

          .step small {
            display: none;
          }

          .workspace {
            grid-template-columns: 1fr;
          }

          .side {
            display: none;
          }

          .hero {
            padding-left: 18px;
            padding-right: 18px;
          }

          .steps,
          .workspace {
            padding-left: 18px;
            padding-right: 18px;
          }
        }
      `}</style>
    </main>
  );
}
