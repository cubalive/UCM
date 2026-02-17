import { useRef, useState, useCallback } from "react";
import SignatureCanvas from "react-signature-canvas";
import { Button } from "@/components/ui/button";
import { RotateCcw, Check } from "lucide-react";

interface SignaturePadProps {
  onSave: (dataUrl: string) => void;
  label?: string;
  height?: number;
}

export default function SignaturePad({ onSave, label = "Sign here", height = 120 }: SignaturePadProps) {
  const sigRef = useRef<SignatureCanvas>(null);
  const [isEmpty, setIsEmpty] = useState(true);

  const handleClear = useCallback(() => {
    sigRef.current?.clear();
    setIsEmpty(true);
  }, []);

  const handleSave = useCallback(() => {
    if (sigRef.current && !sigRef.current.isEmpty()) {
      const dataUrl = sigRef.current.toDataURL("image/png");
      onSave(dataUrl);
    }
  }, [onSave]);

  const handleEnd = useCallback(() => {
    if (sigRef.current) {
      setIsEmpty(sigRef.current.isEmpty());
    }
  }, []);

  return (
    <div className="space-y-2">
      <label className="text-sm text-muted-foreground">{label}</label>
      <div className="border rounded-md bg-white dark:bg-zinc-900 relative" style={{ height }}>
        <SignatureCanvas
          ref={sigRef}
          canvasProps={{
            className: "w-full h-full rounded-md",
            style: { width: "100%", height: "100%" },
            "data-testid": "canvas-signature",
          }}
          onEnd={handleEnd}
          penColor="#1a365d"
          backgroundColor="rgba(0,0,0,0)"
        />
        <div className="absolute bottom-2 left-3 right-3 border-b border-dashed border-muted-foreground/30 pointer-events-none" />
      </div>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleClear}
          data-testid="button-clear-signature"
        >
          <RotateCcw className="w-3.5 h-3.5 mr-1" />
          Clear
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={handleSave}
          disabled={isEmpty}
          data-testid="button-save-signature"
        >
          <Check className="w-3.5 h-3.5 mr-1" />
          Save Signature
        </Button>
      </div>
    </div>
  );
}
