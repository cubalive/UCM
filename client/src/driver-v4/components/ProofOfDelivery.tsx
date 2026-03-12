import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Camera, Pen, Check, X, RotateCcw, ChevronRight, User, Loader2 } from "lucide-react";
import { colors } from "../design/tokens";
import { NeonButton } from "./ui/NeonButton";
import { GlassCard } from "./ui/GlassCard";
import { showToast } from "./ui/Toast";
import { resolveUrl, getStoredToken } from "@/lib/api";
import { DRIVER_TOKEN_KEY } from "@/lib/hostDetection";

interface ProofOfDeliveryProps {
  tripId: number;
  passengerName: string;
  onComplete: () => void;
  onSkip: () => void;
}

type Step = "choose" | "signature" | "photo" | "review";

function getToken(): string | null {
  return localStorage.getItem(DRIVER_TOKEN_KEY) || getStoredToken();
}

async function submitProof(tripId: number, proofType: string, data: Record<string, unknown>) {
  const token = getToken();
  const res = await fetch(resolveUrl(`/api/delivery-proof/${tripId}`), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ proofType, ...data }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: "Failed to submit" }));
    throw new Error(body.message || "Failed to submit proof");
  }
  return res.json();
}

/* ─── Signature Pad ─── */
function SignaturePad({ onSave, onCancel }: { onSave: (data: string) => void; onCancel: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);

  const getXY = (e: React.TouchEvent | React.MouseEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    if ("touches" in e) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    }
    return { x: (e as React.MouseEvent).clientX - rect.left, y: (e as React.MouseEvent).clientY - rect.top };
  };

  const startDrawing = (e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault();
    isDrawing.current = true;
    lastPoint.current = getXY(e);
  };

  const draw = (e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault();
    if (!isDrawing.current || !lastPoint.current) return;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const point = getXY(e);
    ctx.beginPath();
    ctx.moveTo(lastPoint.current.x, lastPoint.current.y);
    ctx.lineTo(point.x, point.y);
    ctx.strokeStyle = "#1a1a2e";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
    lastPoint.current = point;
  };

  const stopDrawing = () => {
    isDrawing.current = false;
    lastPoint.current = null;
  };

  const clear = () => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  const save = () => {
    const canvas = canvasRef.current!;
    const data = canvas.toDataURL("image/png");
    onSave(data);
  };

  useEffect(() => {
    const canvas = canvasRef.current!;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-medium text-center" style={{ color: colors.textSecondary }}>
        Sign below to confirm delivery
      </p>
      <div
        className="relative rounded-2xl overflow-hidden"
        style={{
          border: `2px dashed rgba(0,0,0,0.1)`,
          background: "rgba(255,255,255,0.9)",
          touchAction: "none",
        }}
      >
        <canvas
          ref={canvasRef}
          className="w-full"
          style={{ height: 200, cursor: "crosshair" }}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
        />
        <p
          className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[10px]"
          style={{ color: colors.textTertiary }}
        >
          Sign here
        </p>
      </div>
      <div className="flex gap-2">
        <button
          onClick={onCancel}
          className="flex-1 py-3 rounded-2xl text-sm font-medium"
          style={{ background: "rgba(0,0,0,0.04)", color: colors.textSecondary }}
        >
          Cancel
        </button>
        <button
          onClick={clear}
          className="px-4 py-3 rounded-2xl"
          style={{ background: "rgba(0,0,0,0.04)" }}
        >
          <RotateCcw className="w-4 h-4" style={{ color: colors.textSecondary }} />
        </button>
        <button
          onClick={save}
          className="flex-[2] py-3 rounded-2xl text-sm font-bold text-white"
          style={{ background: `linear-gradient(135deg, ${colors.success}, #2BB84E)` }}
        >
          Confirm Signature
        </button>
      </div>
    </div>
  );
}

/* ─── Photo Capture ─── */
function PhotoCapture({ onSave, onCancel }: { onSave: (data: string) => void; onCancel: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mediaStream: MediaStream | null = null;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } } })
      .then((s) => {
        mediaStream = s;
        setStream(s);
        if (videoRef.current) {
          videoRef.current.srcObject = s;
        }
      })
      .catch(() => {
        setError("Camera access denied. Please allow camera permissions.");
      });

    return () => {
      mediaStream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const capture = () => {
    if (!videoRef.current) return;
    const canvas = document.createElement("canvas");
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(videoRef.current, 0, 0);
    const data = canvas.toDataURL("image/jpeg", 0.8);
    setPhoto(data);
    stream?.getTracks().forEach((t) => t.stop());
  };

  const retake = () => {
    setPhoto(null);
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then((s) => {
        setStream(s);
        if (videoRef.current) {
          videoRef.current.srcObject = s;
        }
      })
      .catch(() => {});
  };

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-sm mb-4" style={{ color: colors.danger }}>{error}</p>
        <button onClick={onCancel} className="text-sm font-medium underline" style={{ color: colors.sunrise }}>
          Go Back
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-medium text-center" style={{ color: colors.textSecondary }}>
        Take a photo as proof of delivery
      </p>
      <div className="relative rounded-2xl overflow-hidden bg-black" style={{ minHeight: 240 }}>
        {!photo ? (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
            style={{ minHeight: 240 }}
          />
        ) : (
          <img src={photo} alt="Captured" className="w-full h-full object-cover" style={{ minHeight: 240 }} />
        )}
      </div>
      <div className="flex gap-2">
        <button
          onClick={onCancel}
          className="flex-1 py-3 rounded-2xl text-sm font-medium"
          style={{ background: "rgba(0,0,0,0.04)", color: colors.textSecondary }}
        >
          Cancel
        </button>
        {!photo ? (
          <button
            onClick={capture}
            className="flex-[2] py-3 rounded-2xl text-sm font-bold text-white flex items-center justify-center gap-2"
            style={{ background: `linear-gradient(135deg, ${colors.sky}, ${colors.ocean})` }}
          >
            <Camera className="w-4 h-4" /> Capture
          </button>
        ) : (
          <>
            <button
              onClick={retake}
              className="px-4 py-3 rounded-2xl"
              style={{ background: "rgba(0,0,0,0.04)" }}
            >
              <RotateCcw className="w-4 h-4" style={{ color: colors.textSecondary }} />
            </button>
            <button
              onClick={() => onSave(photo)}
              className="flex-[2] py-3 rounded-2xl text-sm font-bold text-white"
              style={{ background: `linear-gradient(135deg, ${colors.success}, #2BB84E)` }}
            >
              Use Photo
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/* ─── Main POD Component ─── */
export function ProofOfDelivery({ tripId, passengerName, onComplete, onSkip }: ProofOfDeliveryProps) {
  const [step, setStep] = useState<Step>("choose");
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [photoData, setPhotoData] = useState<string | null>(null);
  const [recipientName, setRecipientName] = useState(passengerName);
  const [submitting, setSubmitting] = useState(false);

  const handleSignatureSave = (data: string) => {
    setSignatureData(data);
    setStep("review");
  };

  const handlePhotoSave = (data: string) => {
    setPhotoData(data);
    setStep("review");
  };

  const handleSubmit = useCallback(async () => {
    setSubmitting(true);
    try {
      if (signatureData) {
        await submitProof(tripId, "SIGNATURE", {
          signatureData,
          recipientName,
        });
      }
      if (photoData) {
        await submitProof(tripId, "PHOTO", {
          photoUrl: photoData,
          recipientName,
        });
      }
      // Also submit GPS proof
      if (navigator.geolocation) {
        try {
          const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 });
          });
          await submitProof(tripId, "GPS_VERIFICATION", {
            gpsLat: pos.coords.latitude,
            gpsLng: pos.coords.longitude,
            gpsAccuracy: pos.coords.accuracy,
            recipientName,
          });
        } catch {}
      }
      showToast("success", "Proof of delivery submitted");
      onComplete();
    } catch (err: any) {
      showToast("error", err.message || "Failed to submit proof");
    } finally {
      setSubmitting(false);
    }
  }, [tripId, signatureData, photoData, recipientName, onComplete]);

  return (
    <motion.div
      className="flex flex-col gap-4 p-4"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="text-center">
        <h2 className="text-lg font-bold" style={{ color: colors.textPrimary }}>
          Proof of Delivery
        </h2>
        <p className="text-xs" style={{ color: colors.textSecondary }}>
          Collect proof before completing the trip
        </p>
      </div>

      <AnimatePresence mode="wait">
        {step === "choose" && (
          <motion.div key="choose" className="space-y-3" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {/* Recipient name */}
            <GlassCard variant="elevated" className="!p-4">
              <div className="flex items-center gap-3">
                <User className="w-4 h-4" style={{ color: colors.sky }} />
                <div className="flex-1">
                  <label className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: colors.textTertiary }}>
                    Recipient Name
                  </label>
                  <input
                    type="text"
                    value={recipientName}
                    onChange={(e) => setRecipientName(e.target.value)}
                    className="w-full text-sm font-medium bg-transparent outline-none"
                    style={{ color: colors.textPrimary }}
                    placeholder="Patient or recipient name"
                  />
                </div>
              </div>
            </GlassCard>

            {/* Signature option */}
            <GlassCard variant="elevated" className="!p-0">
              <button
                onClick={() => setStep("signature")}
                className="w-full flex items-center gap-4 p-4"
              >
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `rgba(52,199,89,0.08)` }}>
                  <Pen className="w-5 h-5" style={{ color: colors.success }} />
                </div>
                <div className="flex-1 text-left">
                  <p className="text-sm font-medium" style={{ color: colors.textPrimary }}>Collect Signature</p>
                  <p className="text-[10px]" style={{ color: colors.textTertiary }}>
                    {signatureData ? "Signature captured" : "Get patient/recipient signature"}
                  </p>
                </div>
                {signatureData ? (
                  <Check className="w-5 h-5" style={{ color: colors.success }} />
                ) : (
                  <ChevronRight className="w-4 h-4" style={{ color: colors.textTertiary }} />
                )}
              </button>
            </GlassCard>

            {/* Photo option */}
            <GlassCard variant="elevated" className="!p-0">
              <button
                onClick={() => setStep("photo")}
                className="w-full flex items-center gap-4 p-4"
              >
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `rgba(74,144,217,0.08)` }}>
                  <Camera className="w-5 h-5" style={{ color: colors.sky }} />
                </div>
                <div className="flex-1 text-left">
                  <p className="text-sm font-medium" style={{ color: colors.textPrimary }}>Take Photo</p>
                  <p className="text-[10px]" style={{ color: colors.textTertiary }}>
                    {photoData ? "Photo captured" : "Photograph the delivery"}
                  </p>
                </div>
                {photoData ? (
                  <Check className="w-5 h-5" style={{ color: colors.success }} />
                ) : (
                  <ChevronRight className="w-4 h-4" style={{ color: colors.textTertiary }} />
                )}
              </button>
            </GlassCard>

            {/* Submit or skip */}
            <div className="space-y-2 pt-2">
              {(signatureData || photoData) && (
                <NeonButton
                  title={submitting ? "Submitting..." : "Submit & Complete Trip"}
                  onPress={handleSubmit}
                  variant="primary"
                  disabled={submitting}
                  testID="btn-submit-pod"
                  icon={submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
                />
              )}
              <button
                onClick={onSkip}
                className="w-full py-2.5 text-xs font-medium"
                style={{ color: colors.textTertiary }}
              >
                Skip — Complete without proof
              </button>
            </div>
          </motion.div>
        )}

        {step === "signature" && (
          <motion.div key="signature" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
            <SignaturePad onSave={handleSignatureSave} onCancel={() => setStep("choose")} />
          </motion.div>
        )}

        {step === "photo" && (
          <motion.div key="photo" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
            <PhotoCapture onSave={handlePhotoSave} onCancel={() => setStep("choose")} />
          </motion.div>
        )}

        {step === "review" && (
          <motion.div key="review" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-3">
            <GlassCard variant="elevated" className="!p-4">
              <p className="text-sm font-semibold mb-2" style={{ color: colors.textPrimary }}>Proof Collected</p>
              {signatureData && (
                <div className="mb-2">
                  <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: colors.textTertiary }}>Signature</p>
                  <img src={signatureData} alt="Signature" className="w-full h-16 object-contain rounded-lg bg-white/50" />
                </div>
              )}
              {photoData && (
                <div>
                  <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: colors.textTertiary }}>Photo</p>
                  <img src={photoData} alt="Delivery" className="w-full h-32 object-cover rounded-lg" />
                </div>
              )}
            </GlassCard>
            <div className="flex gap-2">
              <button
                onClick={() => setStep("choose")}
                className="flex-1 py-3 rounded-2xl text-sm font-medium"
                style={{ background: "rgba(0,0,0,0.04)", color: colors.textSecondary }}
              >
                Add More
              </button>
              <button
                onClick={handleSubmit}
                className="flex-[2] py-3 rounded-2xl text-sm font-bold text-white flex items-center justify-center gap-2"
                style={{
                  background: `linear-gradient(135deg, ${colors.success}, #2BB84E)`,
                  opacity: submitting ? 0.7 : 1,
                }}
                disabled={submitting}
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Submit & Complete
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
