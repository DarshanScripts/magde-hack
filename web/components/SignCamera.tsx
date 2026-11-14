"use client";

import { useEffect, useRef, useState } from "react";
import {
  DrawingUtils,
  FaceLandmarker,
  FilesetResolver,
  HandLandmarker,
  PoseLandmarker,
  type FaceLandmarkerResult,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";
import { SIGN_WS_URL, type SignCameraProps } from "@/lib/contract";

const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.2/wasm";
const MODELS = "https://storage.googleapis.com/mediapipe-models";
const HAND_MODEL = `${MODELS}/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`;
const POSE_MODEL = `${MODELS}/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`;
const FACE_MODEL = `${MODELS}/face_landmarker/face_landmarker/float16/1/face_landmarker.task`;
const ARM_CONNECTIONS = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16]].map(([start, end]) => ({ start, end }));
const ARM_POINTS = [11, 12, 13, 14, 15, 16];
const FACE_CONNECTIONS = [
  ...FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW,
  ...FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW,
  ...FaceLandmarker.FACE_LANDMARKS_LEFT_EYE,
  ...FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE,
  ...FaceLandmarker.FACE_LANDMARKS_LIPS,
];
const FACE_BLENDSHAPES = new Set([
  "browDownLeft", "browDownRight", "browInnerUp", "browOuterUpLeft", "browOuterUpRight",
  "eyeBlinkLeft", "eyeBlinkRight", "eyeSquintLeft", "eyeSquintRight", "eyeWideLeft", "eyeWideRight",
  "cheekPuff", "jawOpen", "jawForward", "mouthClose", "mouthFunnel", "mouthPucker",
  "mouthRollLower", "mouthRollUpper", "mouthShrugLower", "mouthShrugUpper", "mouthPressLeft", "mouthPressRight",
  "mouthSmileLeft", "mouthSmileRight", "mouthFrownLeft", "mouthFrownRight", "mouthStretchLeft", "mouthStretchRight",
]);
const MAX_BUFFERED = 64 * 1024;
const SLOTS = 3;
const BROW_THRESHOLD = 0.4;

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
const deg = (rad: number) => Math.round((rad * 1800) / Math.PI) / 10;

type Face = { bs: Record<string, number>; rot: [number, number, number] };

function toFace(r: FaceLandmarkerResult): Face | null {
  const cats = r.faceBlendshapes[0]?.categories;
  const m = r.facialTransformationMatrixes[0]?.data;
  if (!cats || !m) return null;
  const bs: Record<string, number> = {};
  for (const c of cats) if (FACE_BLENDSHAPES.has(c.categoryName)) bs[c.categoryName] = r4(c.score);
  return { bs, rot: [deg(Math.asin(-m[2])), deg(Math.atan2(m[6], m[10])), deg(Math.atan2(m[1], m[0]))] };
}

function browState(f: Face | null): "up" | "down" | null {
  if (!f) return null;
  const up = (f.bs.browInnerUp + (f.bs.browOuterUpLeft + f.bs.browOuterUpRight) / 2) / 2;
  const down = (f.bs.browDownLeft + f.bs.browDownRight) / 2;
  return up > BROW_THRESHOLD && up > down ? "up" : down > BROW_THRESHOLD ? "down" : null;
}

const modeMessage = ({ mode, recordLabel, signer }: SignCameraProps) =>
  JSON.stringify(mode === "record" ? { type: "mode", mode, label: recordLabel, signer } : { type: "mode", mode });

async function withFallback<T>(make: (delegate: "GPU" | "CPU") => Promise<T>): Promise<T> {
  try {
    return await make("GPU");
  } catch (e) {
    console.warn("MediaPipe GPU delegate failed, using CPU", e);
    return make("CPU");
  }
}

export default function SignCamera(props: SignCameraProps) {
  const { mode, recordLabel, signer } = props;
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const propsRef = useRef(props);
  const [fps, setFps] = useState(0);
  const [online, setOnline] = useState(false);
  const [signing, setSigning] = useState(false);
  const [brows, setBrows] = useState<"up" | "down" | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    propsRef.current = props;
  });

  useEffect(() => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(modeMessage({ mode, recordLabel, signer }));
  }, [mode, recordLabel, signer]);

  useEffect(() => {
    let closed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      const ws = new WebSocket(SIGN_WS_URL);
      wsRef.current = ws;
      ws.onopen = () => {
        setOnline(true);
        ws.send(modeMessage(propsRef.current));
      };
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        const p = propsRef.current;
        if (m.type === "token") p.onToken?.({ label: m.label, conf: m.conf, t: m.t, top: m.top });
        else if (m.type === "status") {
          setSigning(m.state === "signing");
          p.onStatus?.({ state: m.state, fps: m.fps, online: true });
        } else if (m.type === "recorded") p.onRecorded?.(m.label, m.count);
        else if (m.type === "error") console.warn("sign service:", m.message);
      };
      ws.onclose = () => {
        if (closed) return;
        wsRef.current = null;
        setOnline(false);
        setSigning(false);
        propsRef.current.onStatus?.({ state: "rest", fps: 0, online: false });
        timer = setTimeout(connect, 1000);
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current!;
    const canvas = canvasRef.current!;
    let cancelled = false;
    let stream: MediaStream | undefined;
    let hand: HandLandmarker | undefined;
    let pose: PoseLandmarker | undefined;
    let face: FaceLandmarker | undefined;
    let rvfc = 0;

    const dispose = () => {
      if (rvfc) video.cancelVideoFrameCallback(rvfc);
      stream?.getTracks().forEach((t) => t.stop());
      hand?.close();
      pose?.close();
      face?.close();
      stream = hand = pose = face = undefined;
    };

    const start = async () => {
      stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, frameRate: 30 }, audio: false });
      if (cancelled) return dispose();
      video.srcObject = stream;
      await video.play();
      const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
      const [h, p, f] = await Promise.all([
        withFallback((delegate) =>
          HandLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: HAND_MODEL, delegate },
            runningMode: "VIDEO",
            numHands: 2,
          }),
        ),
        withFallback((delegate) =>
          PoseLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: POSE_MODEL, delegate },
            runningMode: "VIDEO",
            numPoses: 1,
          }),
        ),
        withFallback((delegate) =>
          FaceLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: FACE_MODEL, delegate },
            runningMode: "VIDEO",
            numFaces: 1,
            outputFaceBlendshapes: true,
            outputFacialTransformationMatrixes: true,
          }),
        ),
      ]);
      hand = h;
      pose = p;
      face = f;
      if (cancelled) return dispose();
      setReady(true);

      const ctx = canvas.getContext("2d")!;
      const draw = new DrawingUtils(ctx);
      let lastTs = 0;
      let lastT = 0;
      let frames = 0;
      let frameNo = 0;
      let poseLm: NormalizedLandmark[] | undefined;
      let faceLm: NormalizedLandmark[] | undefined;
      let faceData: Face | null = null;
      let lastBrows: "up" | "down" | null = null;
      let fpsStart = performance.now();

      const onFrame = () => {
        if (cancelled || !hand || !pose || !face) return;
        const now = performance.now();
        const ts = Math.max(now, lastTs + 1);
        lastTs = ts;
        const hr = hand.detectForVideo(video, ts);
        const slot = frameNo++ % SLOTS;
        if (slot === 0) poseLm = pose.detectForVideo(video, ts).landmarks[0];
        if (slot === 1) {
          const fr = face.detectForVideo(video, ts);
          faceLm = fr.faceLandmarks[0];
          faceData = toFace(fr);
          const b = browState(faceData);
          if (b !== lastBrows) setBrows((lastBrows = b));
        }
        const w = video.videoWidth;
        const hgt = video.videoHeight;
        if (canvas.width !== w || canvas.height !== hgt) {
          canvas.width = w;
          canvas.height = hgt;
        }
        ctx.clearRect(0, 0, w, hgt);
        const arms = poseLm;
        if (arms) {
          draw.drawConnectors(arms, ARM_CONNECTIONS, { color: "#38bdf8", lineWidth: 4 });
          draw.drawLandmarks(ARM_POINTS.map((i) => arms[i]), { color: "#38bdf8", radius: 4 });
        }
        if (faceLm) draw.drawConnectors(faceLm, FACE_CONNECTIONS, { color: "#e879f9", lineWidth: 1.5 });
        for (const lm of hr.landmarks) {
          draw.drawConnectors(lm, HandLandmarker.HAND_CONNECTIONS, { color: "#22c55e", lineWidth: 3 });
          draw.drawLandmarks(lm, { color: "#f97316", lineWidth: 1, radius: 3 });
        }

        const ws = wsRef.current;
        if (ws?.readyState === WebSocket.OPEN && ws.bufferedAmount < MAX_BUFFERED) {
          const t = Math.max(Date.now(), lastT + 1);
          lastT = t;
          ws.send(
            JSON.stringify({
              type: "frame",
              t,
              w,
              h: hgt,
              hands: hr.landmarks.map((lm, i) => ({
                handedness: hr.handedness[i]?.[0]?.categoryName ?? "",
                score: r4(hr.handedness[i]?.[0]?.score ?? 0),
                lm: lm.map((q) => [r4(q.x), r4(q.y), r4(q.z)]),
              })),
              pose: poseLm ? poseLm.map((q) => [r4(q.x), r4(q.y), r4(q.z), r4(q.visibility ?? 0)]) : null,
              face: faceData,
            }),
          );
        }

        frames++;
        if (now - fpsStart >= 1000) {
          setFps(Math.round((frames * 1000) / (now - fpsStart)));
          frames = 0;
          fpsStart = now;
        }
        rvfc = video.requestVideoFrameCallback(onFrame);
      };
      rvfc = video.requestVideoFrameCallback(onFrame);
    };

    start().catch((e) => {
      console.error(e);
      if (!cancelled) setError(e instanceof Error ? e.message : String(e));
    });
    return () => {
      cancelled = true;
      dispose();
    };
  }, []);

  const badge = !online ? "bg-zinc-600" : signing ? "bg-red-600" : "bg-black/60";
  return (
    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-black">
      <video ref={videoRef} className="absolute inset-0 h-full w-full -scale-x-100 object-contain" muted playsInline />
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full -scale-x-100 object-contain" />
      <div className="absolute left-2 top-2 flex gap-2 font-mono text-xs text-white">
        <span className="rounded bg-black/60 px-2 py-1">{fps} fps</span>
        <span className={`rounded px-2 py-1 ${badge}`}>{!online ? "service offline" : signing ? "signing" : "rest"}</span>
        {brows && <span className="rounded bg-fuchsia-700 px-2 py-1">brows {brows === "up" ? "↑" : "↓"}</span>}
      </div>
      {(!ready || error) && (
        <div className="absolute inset-0 grid place-items-center p-4 text-center text-white">
          {error ? `Camera/MediaPipe error: ${error}` : "Loading camera and models…"}
        </div>
      )}
    </div>
  );
}
