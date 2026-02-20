"use client";

export interface ChatInputProps {
  input: string;
  setInput: (v: string) => void;
  isSending: boolean;
  isStreaming: boolean;
  pendingImages: string[];
  setPendingImages: React.Dispatch<React.SetStateAction<string[]>>;
  isUploading: boolean;
  isDragOver: boolean;
  setIsDragOver: (v: boolean) => void;
  isComposing: boolean;
  setIsComposing: (v: boolean) => void;
  handleImageFiles: (files: File[]) => Promise<void>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  sendMessage: () => void;
  stopStreaming: () => void;
  openManualUpload: () => void;
  uploadDialogOpen: boolean;
}

export function ChatInput({
  input,
  setInput,
  isSending,
  isStreaming,
  pendingImages,
  setPendingImages,
  isUploading,
  isDragOver,
  setIsDragOver,
  isComposing,
  setIsComposing,
  handleImageFiles,
  fileInputRef,
  sendMessage,
  stopStreaming,
  openManualUpload,
  uploadDialogOpen,
}: ChatInputProps) {
  return (
    <footer className="border-t border-slate-800 px-4 py-3">
      <div className="flex flex-col gap-2">
        {pendingImages.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {pendingImages.map((url, i) => (
              <div key={url} className="group relative">
                <img
                  src={url}
                  alt={`Pending ${i + 1}`}
                  className="h-12 w-12 rounded border border-slate-700 object-cover"
                />
                <button
                  className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-slate-700 text-[8px] text-slate-200 opacity-0 transition group-hover:opacity-100 hover:bg-rose-500"
                  onClick={() =>
                    setPendingImages((prev) => prev.filter((_, idx) => idx !== i))
                  }
                  type="button"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
        <div
          className={`relative rounded border transition ${isDragOver ? "border-emerald-400 bg-emerald-500/10" : "border-slate-700"}`}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragOver(false);
            void handleImageFiles(Array.from(e.dataTransfer.files));
          }}
        >
          <textarea
            className="h-20 w-full resize-none rounded bg-slate-900 px-3 py-2 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
            placeholder={isDragOver ? "松开以上传图片…" : "Type message… (Enter to send)"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (isComposing) return;
              const native = e.nativeEvent;
              const composing =
                typeof native === "object" &&
                native !== null &&
                "isComposing" in native &&
                (native as { isComposing?: boolean }).isComposing === true;
              if (composing) return;
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files);
              if (files.some((f) => f.type.startsWith("image/"))) {
                e.preventDefault();
                void handleImageFiles(files);
              }
            }}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionEnd={() => setIsComposing(false)}
            disabled={isSending}
          />
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                void handleImageFiles(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
            <button
              className="rounded border border-slate-700 px-2 py-1 text-[10px] text-slate-300 hover:border-slate-500 disabled:opacity-40"
              onClick={() => fileInputRef.current?.click()}
              type="button"
              disabled={isSending || isUploading}
            >
              {isUploading ? "…" : "图片"}
            </button>
            <button
              className="rounded border border-slate-700 px-2 py-1 text-[10px] text-slate-300 hover:border-slate-500 disabled:opacity-40"
              onClick={openManualUpload}
              type="button"
              disabled={isSending || uploadDialogOpen}
              title="上传文件到指定接口"
            >
              文件
            </button>
          </div>
          {isStreaming ? (
            <button
              className="rounded bg-rose-500 px-3 py-1 text-xs font-semibold text-white hover:bg-rose-600"
              onClick={stopStreaming}
              type="button"
            >
              Stop
            </button>
          ) : (
            <button
              className="rounded bg-emerald-500 px-3 py-1 text-xs font-semibold text-emerald-950 disabled:opacity-60"
              onClick={sendMessage}
              disabled={isSending || input.trim().length === 0}
              type="button"
            >
              Send
            </button>
          )}
        </div>
      </div>
    </footer>
  );
}
