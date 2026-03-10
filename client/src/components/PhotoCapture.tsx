import { useRef, useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Camera, RotateCcw, Check, X } from "lucide-react";

interface PhotoCaptureProps {
  onCapture: (imageData: string) => void;
  facingMode?: "environment" | "user";
}

export default function PhotoCapture({
  onCapture,
  facingMode = "environment",
}: PhotoCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [cameraActive, setCameraActive] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  }, []);

  const startCamera = useCallback(async () => {
    setError(null);
    setCapturedImage(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode,
          width: { ideal: 1280 },
          height: { ideal: 960 },
        },
        audio: false,
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setCameraActive(true);
    } catch (err: any) {
      console.error("[PhotoCapture] Camera access error:", err.message);
      if (err.name === "NotAllowedError") {
        setError("Camera access denied. Please allow camera access and try again.");
      } else if (err.name === "NotFoundError") {
        setError("No camera found on this device.");
      } else {
        setError("Unable to access camera. Please try again.");
      }
    }
  }, [facingMode]);

  // Stop camera on unmount
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  function takePhoto() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);

    setCapturedImage(dataUrl);
    stopCamera();
  }

  function handleRetake() {
    setCapturedImage(null);
    startCamera();
  }

  function handleConfirm() {
    if (capturedImage) {
      onCapture(capturedImage);
    }
  }

  function handleCancel() {
    setCapturedImage(null);
    stopCamera();
  }

  // Preview of captured image
  if (capturedImage) {
    return (
      <div className="space-y-3">
        <div className="border rounded-md overflow-hidden bg-black">
          <img
            src={capturedImage}
            alt="Captured photo"
            className="w-full object-contain"
            style={{ maxHeight: 320 }}
          />
        </div>

        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleRetake}
            className="flex-1"
          >
            <RotateCcw className="w-4 h-4 mr-1" />
            Retake
          </Button>
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={handleConfirm}
            className="flex-1"
          >
            <Check className="w-4 h-4 mr-1" />
            Use Photo
          </Button>
        </div>
      </div>
    );
  }

  // Camera view
  if (cameraActive) {
    return (
      <div className="space-y-3">
        <div className="border rounded-md overflow-hidden bg-black relative">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full"
            style={{ maxHeight: 320, objectFit: "cover" }}
          />
        </div>

        <canvas ref={canvasRef} className="hidden" />

        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCancel}
            className="flex-1"
          >
            <X className="w-4 h-4 mr-1" />
            Cancel
          </Button>
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={takePhoto}
            className="flex-1"
          >
            <Camera className="w-4 h-4 mr-1" />
            Take Photo
          </Button>
        </div>
      </div>
    );
  }

  // Initial state - camera not active
  return (
    <div className="space-y-3">
      {error && (
        <div className="bg-destructive/10 text-destructive text-sm rounded-md p-3">
          {error}
        </div>
      )}

      <div className="border border-dashed rounded-md p-8 flex flex-col items-center justify-center text-muted-foreground">
        <Camera className="w-10 h-10 mb-2" />
        <p className="text-sm">Take a photo for proof of delivery</p>
      </div>

      <Button
        type="button"
        variant="default"
        size="sm"
        onClick={startCamera}
        className="w-full"
      >
        <Camera className="w-4 h-4 mr-1" />
        Open Camera
      </Button>
    </div>
  );
}
