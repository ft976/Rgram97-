import React, { useState, useRef, useEffect } from "react";
import { formatDistanceToNow } from "date-fns";
import { Send, Image as ImageIcon, Smile, Trash2, Phone, Video, Mic, Check, X, Paperclip, Camera } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { ChatMessage, User } from "@/src/types";
import { VoicePlayer } from "./VoicePlayer";
import { playRecordingBeep, playDisconnectSound } from "@/src/lib/sounds";

const STICKERS = [
  "https://media.giphy.com/media/l41lSLto3wzWuN7Gw/giphy.gif", // Pixel cat
  "https://media.giphy.com/media/3o7TKSjRrfIPjeiVyM/giphy.gif", // Pixel diamond
  "https://media.giphy.com/media/aBovEhyOElqUw/giphy.gif", // Pixel heart
  "https://media.giphy.com/media/26AHG5KGFxSkUWw1i/giphy.gif", // Pixel sword
  "https://media.giphy.com/media/xT0xeQhFXz1Qof55T2/giphy.gif", // Pixel coffee
  "https://media.giphy.com/media/3o7TKWeR2Vw1I9A8xy/giphy.gif"  // Pixel pizza
];

export function Chat({
  messages,
  onSendMessage,
  onDeleteMessage,
  onDeleteForMe,
  currentUser,
  onInitiateCall,
  onViewMessage,
  onTypingChange,
  typingUsers = {},
}: {
  messages: ChatMessage[];
  onSendMessage: (text: string, imageUrl?: string, audioUrl?: string, videoUrl?: string, replyTo?: ChatMessage["replyTo"], isViewOnce?: boolean, customUserId?: string, customUserName?: string) => void;
  onDeleteMessage: (messageId: string) => void;
  onDeleteForMe?: (messageId: string) => void;
  currentUser: User;
  onInitiateCall?: (type: "audio" | "video") => void;
  onViewMessage?: (messageId: string) => void;
  onTypingChange?: (isTyping: boolean) => void;
  typingUsers?: Record<string, string>;
}) {
  const [text, setText] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [showImageInput, setShowImageInput] = useState(false);
  const [showStickers, setShowStickers] = useState(false);
  const [selectedMsgId, setSelectedMsgId] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [highlightedMsgId, setHighlightedMsgId] = useState<string | null>(null);
  const [isMirrored, setIsMirrored] = useState(false);
  const [viewerMedia, setViewerMedia] = useState<{
    id: string;
    type: "image" | "video";
    url: string;
    isMine: boolean;
  } | null>(null);
  const [capturedPhotoUrl, setCapturedPhotoUrl] = useState<string | null>(null);
  const [capturedVideoUrl, setCapturedVideoUrl] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // New Camera & Attachment Menu States
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [isRecordingVideo, setIsRecordingVideo] = useState(false);
  const [videoElapsed, setVideoElapsed] = useState(0);
  const mediaRecorderVideoRef = useRef<MediaRecorder | null>(null);
  const videoChunksRef = useRef<Blob[]>([]);
  const videoTimerRef = useRef<any>(null);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);

  // Voice Note state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<any>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    // Dismiss option dropdown on global click outside
    const handleGlobalClick = () => {
      setSelectedMsgId(null);
    };
    window.addEventListener("click", handleGlobalClick);
    return () => {
      window.removeEventListener("click", handleGlobalClick);
      if (timerRef.current) clearInterval(timerRef.current);
      if (videoTimerRef.current) clearInterval(videoTimerRef.current);
      if (cameraStream) {
        cameraStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [cameraStream]);

  // Ref to track last alert timestamp to throttle notifications
  const lastAlertTimeRef = useRef<number>(0);
  const lastTypingTimeRef = useRef<number>(0);
  const isTypingLocalRef = useRef<boolean>(false);

  // Inform other users that we are currently typing (with inactivity auto-reset of 1.5s)
  useEffect(() => {
    if (!onTypingChange) return;

    if (text.trim().length > 0) {
      if (!isTypingLocalRef.current) {
        isTypingLocalRef.current = true;
        onTypingChange(true);
      }
      lastTypingTimeRef.current = Date.now();

      const timer = setTimeout(() => {
        if (Date.now() - lastTypingTimeRef.current >= 1400) {
          isTypingLocalRef.current = false;
          onTypingChange(false);
        }
      }, 1500);

      return () => clearTimeout(timer);
    } else {
      if (isTypingLocalRef.current) {
        isTypingLocalRef.current = false;
        onTypingChange(false);
      }
    }
  }, [text, onTypingChange]);

  useEffect(() => {
    const triggerSecurityAlert = (msgText: string) => {
      const now = Date.now();
      if (now - lastAlertTimeRef.current < 4000) return; // Prevent alert spam (4s gap)
      lastAlertTimeRef.current = now;
      onSendMessage(msgText, undefined, undefined, undefined, undefined, false, "system_alert");
    };

    // Keyboard screenshot detection
    const handleKeyDown = (e: KeyboardEvent) => {
      const isPrintScreen = e.key === "PrintScreen" || e.keyCode === 44 || e.code === "PrintScreen";
      
      // Mac Screenshot combinations: Cmd + Shift + 3, Cmd + Shift + 4, Cmd + Shift + 5, Cmd + Shift + 6
      const isMacScreenshot = e.metaKey && e.shiftKey && ["3", "4", "5", "6"].includes(e.key);
      
      // Windows Screenshot combination: Win + Shift + S
      const isWinScreenshot = e.metaKey && e.shiftKey && e.key?.toLowerCase() === "s";
      
      // Secondary capture combos (Ctrl+P, Ctrl+S)
      const isCaptureCombo = (e.ctrlKey || e.metaKey) && ["p", "s"].includes(e.key?.toLowerCase());

      if (isPrintScreen || isMacScreenshot || isWinScreenshot || isCaptureCombo) {
        if (viewerMedia) {
          // Inside once-view lightbox
          const targetMsg = messages.find((m) => m.id === viewerMedia.id);
          if (targetMsg?.isViewOnce) {
            if (onViewMessage) {
              onViewMessage(viewerMedia.id);
            }
            setViewerMedia(null);
            triggerSecurityAlert(`🛡️ @${currentUser.name} tried to capture private media! Closed & hidden.`);
          }
        }
      }
    };

    // Tab blur / Visibility change (detecting screenshot overlays like Snipping Tool)
    const handleVisibilityOrBlur = (e: Event) => {
      // Screen Recording activation / app context switches / phone native overlay triggers blur
      if (e.type === "blur" || document.visibilityState === "hidden") {
        if (viewerMedia) {
          // Check if this was a once-view media
          const targetMsg = messages.find((m) => m.id === viewerMedia.id);
          if (targetMsg?.isViewOnce) {
            // Close immediately to protect the media from screenshotting!
            setViewerMedia(null);
            
            // Mark as viewed so it cannot be reopened
            if (onViewMessage) {
              onViewMessage(viewerMedia.id);
            }
            
            triggerSecurityAlert(`🛡️ @${currentUser.name} left OnceView screen! Content hidden.`);
          }
        }
      }
    };

    // Mobile / Phone touch swipe capture & layout resize heuristics
    let lastHeight = window.innerHeight;
    let lastWidth = window.innerWidth;

    const handleResize = () => {
      const hDiff = Math.abs(window.innerHeight - lastHeight);
      const wDiff = Math.abs(window.innerWidth - lastWidth);
      lastHeight = window.innerHeight;
      lastWidth = window.innerWidth;

      // Mobile screenshotting overlays or video-recording controls cause sudden viewport/geometry change
      if ((hDiff > 45 || wDiff > 45) && viewerMedia) {
        const targetMsg = messages.find((m) => m.id === viewerMedia.id);
        if (targetMsg?.isViewOnce) {
          if (onViewMessage) {
            onViewMessage(viewerMedia.id);
          }
          setViewerMedia(null);
          triggerSecurityAlert(`🛡️ @${currentUser.name} phone screen capture/resize layout trigger! Closed.`);
        }
      }
    };

    // Detection of multi-touch screenshot gestures (e.g. 3-finger swipe screenshot on Android)
    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length >= 3) {
        if (viewerMedia) {
          const targetMsg = messages.find((m) => m.id === viewerMedia.id);
          if (targetMsg?.isViewOnce) {
            if (onViewMessage) {
              onViewMessage(viewerMedia.id);
            }
            setViewerMedia(null);
            triggerSecurityAlert(`🛡️ @${currentUser.name} three-finger swipe gesture screenshot! Private media closed.`);
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("blur", handleVisibilityOrBlur);
    document.addEventListener("visibilitychange", handleVisibilityOrBlur);
    window.addEventListener("resize", handleResize);
    window.addEventListener("touchstart", handleTouchStart, { passive: true });

    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("blur", handleVisibilityOrBlur);
      document.removeEventListener("visibilitychange", handleVisibilityOrBlur);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("touchstart", handleTouchStart);
    };
  }, [viewerMedia, messages, currentUser, onSendMessage, onViewMessage]);

  const handleFileSystemUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type.startsWith("video/")) {
      const videoEl = document.createElement("video");
      videoEl.preload = "metadata";
      videoEl.src = URL.createObjectURL(file);
      videoEl.onloadedmetadata = () => {
        URL.revokeObjectURL(videoEl.src);
        if (videoEl.duration > 100) {
          alert("⚠️ Mini video can only be up to 100 seconds!");
          return;
        }
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onloadend = () => {
          setCapturedVideoUrl(reader.result as string);
          setIsCameraActive(true);
          setShowAttachMenu(false);
        };
      };
    } else if (file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onloadend = () => {
        setCapturedPhotoUrl(reader.result as string);
        setIsCameraActive(true);
        setShowAttachMenu(false);
      };
    } else {
      alert("⚠️ Only images and mini videos are supported!");
    }
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setCameraStream(stream);
      setIsCameraActive(true);
      setShowAttachMenu(false);
      setTimeout(() => {
        if (cameraVideoRef.current) {
          cameraVideoRef.current.srcObject = stream;
        }
      }, 200);
    } catch (err) {
      console.warn("Camera failed:", err);
      alert("Please allow camera & microphone permissions to capture media.");
    }
  };

  const stopCamera = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
    }
    setCameraStream(null);
    setIsCameraActive(false);
    setIsRecordingVideo(false);
    setCapturedPhotoUrl(null);
    setCapturedVideoUrl(null);
    if (videoTimerRef.current) {
      clearInterval(videoTimerRef.current);
    }
  };

  const snapPhoto = () => {
    if (!cameraVideoRef.current) return;
    const video = cameraVideoRef.current;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      // Draw exactly what is seen in the video stream (no mirror applied here)
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg");
      setCapturedPhotoUrl(dataUrl);
    }
  };

  const sendCapturedPhoto = (isViewOnce = false) => {
    if (!capturedPhotoUrl) return;
    onSendMessage(
      "",
      capturedPhotoUrl,
      undefined,
      undefined,
      replyTo ? {
        id: replyTo.id,
        userName: replyTo.userName,
        text: replyTo.text,
        audioUrl: !!replyTo.audioUrl,
        imageUrl: !!replyTo.imageUrl,
        videoUrl: !!replyTo.videoUrl
      } : undefined,
      isViewOnce
    );
    setReplyTo(null);
    setCapturedPhotoUrl(null);
    stopCamera();
  };

  const sendCapturedVideo = (isViewOnce = false) => {
    if (!capturedVideoUrl) return;
    onSendMessage(
      "",
      undefined,
      undefined,
      capturedVideoUrl,
      replyTo ? {
        id: replyTo.id,
        userName: replyTo.userName,
        text: replyTo.text,
        audioUrl: !!replyTo.audioUrl,
        imageUrl: !!replyTo.imageUrl,
        videoUrl: !!replyTo.videoUrl
      } : undefined,
      isViewOnce
    );
    setReplyTo(null);
    setCapturedVideoUrl(null);
    stopCamera();
  };

  const startRecordingVideo = () => {
    if (!cameraStream) return;
    videoChunksRef.current = [];
    const options = { mimeType: "video/webm;codecs=vp9,opus" };
    let mediaRecorder: MediaRecorder;
    try {
      mediaRecorder = new MediaRecorder(cameraStream, options);
    } catch (e) {
      try {
        mediaRecorder = new MediaRecorder(cameraStream);
      } catch (err) {
        console.warn("Could not start video recorder:", err);
        return;
      }
    }
    mediaRecorderVideoRef.current = mediaRecorder;
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        videoChunksRef.current.push(event.data);
      }
    };

    mediaRecorder.onstop = () => {
      const videoBlob = new Blob(videoChunksRef.current, { type: "video/webm" });
      const reader = new FileReader();
      reader.readAsDataURL(videoBlob);
      reader.onloadend = () => {
        setCapturedVideoUrl(reader.result as string);
      };
    };

    mediaRecorder.start();
    setIsRecordingVideo(true);
    setVideoElapsed(0);
    playRecordingBeep();

    videoTimerRef.current = setInterval(() => {
      setVideoElapsed((prev) => {
        if (prev >= 99) {
          clearInterval(videoTimerRef.current);
          mediaRecorder.stop();
          return 100;
        }
        return prev + 1;
      });
    }, 1000);
  };

  const stopRecordingVideo = () => {
    if (mediaRecorderVideoRef.current && mediaRecorderVideoRef.current.state !== "inactive") {
      mediaRecorderVideoRef.current.stop();
    }
    if (videoTimerRef.current) {
      clearInterval(videoTimerRef.current);
    }
    setIsRecordingVideo(false);
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = () => {
          const base64Audio = reader.result as string;
          onSendMessage(
            "",
            undefined,
            base64Audio,
            undefined,
            replyTo ? {
              id: replyTo.id,
              userName: replyTo.userName,
              text: replyTo.text,
              audioUrl: !!replyTo.audioUrl,
              imageUrl: !!replyTo.imageUrl,
              videoUrl: !!replyTo.videoUrl
            } : undefined
          );
          setReplyTo(null);
        };
        stream.getTracks().forEach((track) => track.stop());
      };

      playRecordingBeep();
      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);

      timerRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      console.warn("Could not start recording:", err);
      alert("Please allow microphone access to record voice notes.");
    }
  };

  const stopRecording = (shouldSend = true) => {
    if (!mediaRecorderRef.current || mediaRecorderRef.current.state === "inactive") return;

    if (timerRef.current) {
      clearInterval(timerRef.current);
    }

    if (shouldSend) {
      mediaRecorderRef.current.stop();
    } else {
      mediaRecorderRef.current.onstop = null;
      if (mediaRecorderRef.current.stream) {
        mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      }
      playDisconnectSound();
    }

    setIsRecording(false);
    setRecordingTime(0);
  };

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() && !imageUrl.trim()) return;

    if (imageUrl.trim()) {
      setCapturedPhotoUrl(imageUrl.trim());
      setIsCameraActive(true);
      setImageUrl("");
      setShowImageInput(false);
      return;
    }

    onSendMessage(
      text,
      undefined,
      undefined,
      undefined,
      replyTo ? {
        id: replyTo.id,
        userName: replyTo.userName,
        text: replyTo.text,
        audioUrl: !!replyTo.audioUrl,
        imageUrl: !!replyTo.imageUrl,
        videoUrl: !!replyTo.videoUrl
      } : undefined
    );
    setText("");
    setImageUrl("");
    setReplyTo(null);
    setShowImageInput(false);
    setShowStickers(false);
  };

  const sendSticker = (url: string) => {
    onSendMessage(
      "",
      url,
      undefined,
      undefined,
      replyTo ? {
        id: replyTo.id,
        userName: replyTo.userName,
        text: replyTo.text,
        audioUrl: !!replyTo.audioUrl,
        imageUrl: !!replyTo.imageUrl,
        videoUrl: !!replyTo.videoUrl
      } : undefined
    );
    setReplyTo(null);
    setShowStickers(false);
  };

  const formatRecordingTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  const displayMessages = messages.filter(m => !m.hiddenFor?.includes(currentUser.id));

  return (
    <div className="flex flex-col h-full bg-sky-100 pixel-grid relative">
      <div className="bg-sky-500 py-1.5 px-4 border-b-4 border-black sticky top-0 z-10 flex justify-between items-center shadow-sm">
        <h2 className="font-pixel text-[10px] sm:text-xs text-white pixel-text-shadow">LIVE CHAT</h2>
        <div className="flex gap-2">
          <button
            onClick={() => onInitiateCall?.("audio")}
            className="p-1 px-1.5 bg-green-500 hover:bg-green-400 text-white pixel-border-sm flex items-center gap-1 text-[8px] font-pixel cursor-pointer transition-all active:translate-y-0.5"
            title="Audio Call"
          >
            <Phone size={10} className="stroke-[3px]" />
            <span>CALL</span>
          </button>
          <button
            onClick={() => onInitiateCall?.("video")}
            className="p-1 px-1.5 bg-pink-500 hover:bg-pink-400 text-white pixel-border-sm flex items-center gap-1 text-[8px] font-pixel cursor-pointer transition-all active:translate-y-0.5"
            title="Video Call"
          >
            <Video size={10} className="stroke-[3px]" />
            <span>VIDEO</span>
          </button>
        </div>
      </div>

      {/* Messages list with tighter pixelated margins */}
      <div className="flex-1 p-2 sm:p-3 overflow-y-auto flex flex-col gap-0.5 pb-36">
        {displayMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 text-center text-sky-500 h-full select-none">
            <MessageEmptyIcon />
            <p className="font-pixel text-xs mt-4">NO MESSAGES</p>
            <p className="text-lg mt-2 font-pixel text-sky-400">Say hello!</p>
          </div>
        ) : (
          displayMessages.map((msg, idx) => {
            if (msg.userId === "system_call" || msg.userId === "system_alert") {
              const isSecurity = msg.userId === "system_alert" || msg.text.includes("SHIELD") || msg.text.includes("SECURITY") || msg.text.includes("ALERT") || msg.text.includes("WARNING");
              return (
                <div key={msg.id} className="w-full flex justify-center my-1.5 select-none select-none">
                  <div className={`pixel-border-gap m-1 p-1.5 px-2.5 flex items-center justify-center gap-1.5 max-w-[95%] text-center font-pixel text-[8px] sm:text-[9px] leading-tight shadow-md border border-black rounded-xs ${
                    isSecurity 
                      ? "bg-red-950 text-red-200" 
                      : "bg-sky-950 text-yellow-300"
                  }`}>
                    <span>{isSecurity ? "🔏" : "👾"}</span>
                    <span className="uppercase tracking-tighter">{msg.text}</span>
                    <span className={`text-[6px] sm:text-[7px] opacity-60 ml-1 ${isSecurity ? "text-red-400" : "text-sky-400"}`}>
                      {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
              );
            }

            const isMe = msg.userId === currentUser.id;
            const showAvatar = idx === 0 || (displayMessages[idx - 1].userId !== msg.userId && displayMessages[idx - 1].userId !== "system_call" && displayMessages[idx - 1].userId !== "system_alert");
            const isConsecutive = idx > 0 && displayMessages[idx - 1].userId === msg.userId && displayMessages[idx - 1].userId !== "system_call" && displayMessages[idx - 1].userId !== "system_alert";

            return (
              <SwipeableMessage
                key={msg.id}
                isDisabled={msg.isDeleted}
                onSwipeReply={() => {
                  setReplyTo(msg);
                }}
              >
                <div
                  id={`msg-container-${msg.id}`}
                  className={`flex gap-2 max-w-[85%] relative group ${
                    isMe ? "self-end flex-row-reverse" : "self-start"
                  } ${isConsecutive ? "mt-[2px]" : "mt-1.5"}`}
                >
                  {!isMe && (
                    <div className="w-6 shrink-0">
                      {showAvatar && (
                        <img
                          src={msg.userAvatarUrl || `https://api.dicebear.com/7.x/pixel-art/svg?seed=${msg.userId}`}
                          alt="Avatar"
                          className="w-6 h-6 pixel-border-sm bg-white"
                          title={msg.userName || msg.userId}
                        />
                      )}
                    </div>
                  )}

                  <div className={`flex flex-col ${isMe ? "items-end" : "items-start"} max-w-full`}>
                    {!isMe && showAvatar && (
                      <span className="font-pixel text-[7px] text-sky-700 mb-0.5 ml-1">
                        {msg.userName || `USER_${msg.userId.substring(0, 4)}`}
                      </span>
                    )}
                    
                    <div className="relative flex items-center group/bubble max-w-full">
                      {/* Retro 3-dots actions trigger button */}
                      {!msg.isDeleted && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedMsgId(selectedMsgId === msg.id ? null : msg.id);
                          }}
                          className="absolute top-1/2 -translate-y-1/2 opacity-0 group-hover/bubble:opacity-100 bg-white border border-black p-0.5 px-1 text-[8px] font-bold font-pixel pixel-border-sm hover:bg-pink-100 transition-all select-none z-20 shrink-0 shadow-xs cursor-pointer"
                          style={isMe ? { right: "100%", marginRight: "4px" } : { left: "100%", marginLeft: "4px" }}
                          title="Options"
                        >
                          •••
                        </button>
                      )}

                      {/* Compact Pixel Dropdown Context Menu */}
                      {selectedMsgId === msg.id && !msg.isDeleted && (
                        <div
                          className={`absolute bg-white border-2 border-black p-1 shadow-[3px_3px_0_0_#db2777] min-w-[124px] sm:min-w-[140px] z-40 flex flex-col gap-1 ${
                            idx < 3 ? "top-full mt-1.5" : "bottom-full mb-1.5"
                          } ${isMe ? "right-0" : "left-0"}`}
                        >
                          {/* VIEW Option for Media */}
                          {(msg.imageUrl || msg.videoUrl) && (
                            msg.isViewOnce ? (
                              !msg.isOpened && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setViewerMedia({
                                      id: msg.id,
                                      type: msg.imageUrl ? "image" : "video",
                                      url: (msg.imageUrl || msg.videoUrl)!,
                                      isMine: msg.userId === currentUser.id
                                    });
                                    setSelectedMsgId(null);
                                    if (onViewMessage) {
                                      onViewMessage(msg.id);
                                    }
                                  }}
                                  className="text-left font-pixel text-[9px] sm:text-[10px] hover:bg-sky-100 p-2 sm:p-2.5 px-3 cursor-pointer text-pink-600 transition-colors uppercase block w-full font-bold border-b border-dashed border-gray-100 animate-pulse"
                                >
                                  🔐 OPEN & VIEW
                                </button>
                              )
                            ) : (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setViewerMedia({
                                    id: msg.id,
                                    type: msg.imageUrl ? "image" : "video",
                                    url: (msg.imageUrl || msg.videoUrl)!,
                                    isMine: msg.userId === currentUser.id
                                  });
                                  setSelectedMsgId(null);
                                }}
                                className="text-left font-pixel text-[9px] sm:text-[10px] hover:bg-sky-100 p-2 sm:p-2.5 px-3 cursor-pointer text-sky-800 transition-colors uppercase block w-full font-bold border-b border-dashed border-gray-100"
                              >
                                👁️ VIEW MEDIA
                              </button>
                            )
                          )}

                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setReplyTo(msg);
                              setSelectedMsgId(null);
                            }}
                            className="text-left font-pixel text-[9px] sm:text-[10px] hover:bg-sky-100 p-2 sm:p-2.5 px-3 cursor-pointer text-sky-800 transition-colors uppercase block w-full font-bold border-b border-dashed border-gray-100"
                          >
                            💬 REPLY
                          </button>
                          
                          {msg.text && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                navigator.clipboard.writeText(msg.text);
                                setSelectedMsgId(null);
                              }}
                              className="text-left font-pixel text-[9px] sm:text-[10px] hover:bg-sky-100 p-2 sm:p-2.5 px-3 cursor-pointer text-purple-700 transition-colors uppercase block w-full font-bold border-b border-dashed border-gray-100"
                            >
                              📋 COPY
                            </button>
                          )}

                          {onDeleteForMe && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onDeleteForMe(msg.id);
                                setSelectedMsgId(null);
                              }}
                              className="text-left font-pixel text-[9px] sm:text-[10px] hover:bg-red-50 p-2 sm:p-2.5 px-3 cursor-pointer text-red-600 transition-colors uppercase block w-full font-bold border-b border-dashed border-gray-100"
                            >
                              🗑️ DELETE FOR ME
                            </button>
                          )}

                          {isMe && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onDeleteMessage(msg.id);
                                setSelectedMsgId(null);
                              }}
                              className="text-left font-pixel text-[9px] sm:text-[10px] hover:bg-red-100 p-2 sm:p-2.5 px-3 cursor-pointer text-red-600 transition-colors uppercase block w-full font-bold"
                            >
                              🚀 UNSEND
                            </button>
                          )}
                        </div>
                      )}

                      <div
                        onClick={(e) => {
                          if (msg.isDeleted) return;
                          const target = e.target as HTMLElement;
                          if (target.closest('button') || target.closest('input') || target.closest('audio') || target.closest('a')) {
                            return;
                          }
                          e.stopPropagation();
                          setSelectedMsgId(selectedMsgId === msg.id ? null : msg.id);
                        }}
                        className={msg.audioUrl && !msg.isDeleted ? "cursor-pointer" : `cursor-pointer pixel-border-gap m-1 p-1.5 px-3 text-[22px] sm:text-[26px] break-words relative flex flex-col w-fit ${
                          isMe ? "bg-pink-500 text-white" : "bg-white text-black"
                        } ${highlightedMsgId === msg.id ? "ring-4 ring-yellow-400 !bg-yellow-200 !text-black scale-105 transition-all duration-300" : ""}`}
                      >
                        {/* Quoted Reply inside chat container */}
                        {msg.replyTo && !msg.isDeleted && (
                          <div 
                            onClick={(e) => {
                              e.stopPropagation();
                              const replyTargetId = msg.replyTo?.id;
                              if (replyTargetId) {
                                const el = document.getElementById(`msg-container-${replyTargetId}`);
                                if (el) {
                                  el.scrollIntoView({ behavior: "smooth", block: "center" });
                                  setHighlightedMsgId(replyTargetId);
                                  setTimeout(() => {
                                    setHighlightedMsgId(null);
                                  }, 2000);
                                }
                              }
                            }}
                            className="bg-sky-950/25 p-1 px-1.5 mb-1 border-l-2 border-sky-400 font-pixel text-[7px] tracking-tight leading-normal flex flex-col max-w-full cursor-pointer hover:bg-sky-950/45 transition-colors select-none opacity-85 text-left text-white"
                          >
                            <span className="font-bold text-sky-400 block uppercase">↩️ REPLYING TO @{msg.replyTo.userName}</span>
                            <span className="truncate italic max-w-[120px]">
                              {msg.replyTo.audioUrl ? "🎤 Voice Note" : msg.replyTo.imageUrl ? "🖼️ Shared Image" : msg.replyTo.videoUrl ? "🎥 Mini Video" : msg.replyTo.text}
                            </span>
                          </div>
                        )}

                        {/* Message Content or Deletion Template */}
                        {msg.isDeleted ? (
                          <div className={`italic select-none flex items-center gap-1.5 leading-[1.1] text-[9px] sm:text-[10px] font-pixel ${
                            isMe ? "text-pink-200" : "text-gray-400"
                          }`}>
                            <span>🚫</span>
                            <span>{msg.audioUrl ? "VOICE NOTE DELETED" : msg.imageUrl ? "IMAGE DELETED" : msg.videoUrl ? "VIDEO DELETED" : "MESSAGE DELETED"}</span>
                          </div>
                        ) : (
                          <>
                            {msg.audioUrl && (
                              <VoicePlayer audioUrl={msg.audioUrl} />
                            )}
                            {msg.isViewOnce ? (
                              msg.isOpened ? (
                                <div className="flex items-center gap-1.5 p-2 bg-zinc-800 border border-dashed border-zinc-650 opacity-60 font-pixel text-[8px] sm:text-[9px] text-zinc-400 select-none mb-1">
                                  <span>🔒</span>
                                  <span>ONE-TIME VIEW MEDIA (OPENED)</span>
                                </div>
                              ) : (
                                <div className="flex flex-col gap-1 w-[160px] sm:w-[180px] mb-1">
                                  <div className="bg-pink-900 text-white border-2 border-black p-1 px-1.5 flex items-center justify-between font-pixel text-[8px] select-none rounded-t-sm shadow-[1px_1px_0_0_#000]">
                                    <span className="animate-pulse text-pink-300">🔏 PRIVATE</span>
                                    <span className="text-yellow-450">ONCE_VIEW</span>
                                  </div>
                                  <div 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setViewerMedia({
                                        id: msg.id,
                                        type: msg.imageUrl ? "image" : "video",
                                        url: (msg.imageUrl || msg.videoUrl)!,
                                        isMine: msg.userId === currentUser.id
                                      });
                                      setSelectedMsgId(null);
                                      if (onViewMessage) {
                                        onViewMessage(msg.id);
                                      }
                                    }}
                                    className="bg-zinc-900 border-2 border-black p-3 flex flex-col items-center justify-center gap-2 cursor-pointer hover:bg-zinc-850 transition-colors shadow-[2px_2px_0_0_#000]"
                                  >
                                    <span className="text-lg animate-bounce">🔐</span>
                                    <span className="font-pixel text-[8px] text-yellow-400 text-center uppercase tracking-tighter">
                                      {msg.imageUrl ? "📷 OPEN PHOTO" : "🎥 OPEN VIDEO"}
                                    </span>
                                    <span className="font-pixel text-[6px] text-zinc-550 uppercase">expires post-reading</span>
                                  </div>
                                </div>
                              )
                            ) : (
                              <>
                                {msg.imageUrl && (
                                  <div className="flex flex-col max-w-[280px] sm:max-w-sm mb-1 w-fit">
                                    <div className="bg-sky-700 text-white border border-black p-1 px-1.5 flex items-center justify-between font-pixel text-[8px] select-none rounded-t-sm">
                                      <span>📷 RETRO PHOTO</span>
                                      <span className="text-sky-300">SHUTTER_X</span>
                                    </div>
                                    <img
                                      src={msg.imageUrl}
                                      alt="Shared"
                                      className="w-full max-h-64 pixel-border-gap m-0.5 bg-sky-50 object-cover cursor-zoom-in hover:opacity-90 transition-opacity"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setViewerMedia({
                                          id: msg.id,
                                          type: "image",
                                          url: msg.imageUrl!,
                                          isMine: msg.userId === currentUser.id
                                        });
                                      }}
                                      onError={(e) => {
                                        (e.target as HTMLImageElement).style.display = "none";
                                      }}
                                    />
                                  </div>
                                )}
                                {msg.videoUrl && (
                                  <div className="flex flex-col max-w-[280px] sm:max-w-sm mb-1 w-fit">
                                    <div className="bg-purple-800 text-white border border-black p-1 px-1.5 flex items-center justify-between font-pixel text-[8px] select-none rounded-t-sm">
                                      <span>🎥 RETRO VIDEO</span>
                                      <span className="text-yellow-400">PLAY_CAM</span>
                                    </div>
                                    <div className="relative cursor-zoom-in group w-full">
                                      <video
                                        src={msg.videoUrl}
                                        playsInline
                                        muted
                                        className="w-full max-h-64 pixel-border-gap m-0.5 bg-black object-contain text-[8px]"
                                      />
                                      <div 
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setViewerMedia({
                                            id: msg.id,
                                            type: "video",
                                            url: msg.videoUrl!,
                                            isMine: msg.userId === currentUser.id
                                          });
                                        }}
                                        className="absolute inset-0 bg-black/45 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                      >
                                        <span className="font-pixel text-[8px] bg-black text-white p-1.5 border border-white">🔎 VIEW VIDEO</span>
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </>
                            )}
                            {msg.text && <p className="leading-[1.15]">{msg.text}</p>}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </SwipeableMessage>
            );
          })
        )}
        {Object.entries(typingUsers).filter(([userId]) => userId !== currentUser.id).length > 0 && (
          <div className="flex items-center gap-2 p-2 px-3 bg-yellow-50 text-black border border-black font-pixel text-[8px] sm:text-[9px] w-fit rounded-xs my-1 ml-1 select-none self-start transition-all shrink-0 animate-pulse">
            <span className="w-2 h-2 bg-green-500 rounded-full animate-bounce shrink-0" />
            <span className="font-bold tracking-tight uppercase">
              {Object.entries(typingUsers)
                .filter(([userId]) => userId !== currentUser.id)
                .map(([_, name]) => `@${name}`)
                .join(", ")}{" "}
              IS TYPING...
            </span>
            <div className="flex gap-[2.5px] items-center ml-1">
              <span className="w-1 h-1 bg-black rounded-full animate-bounce shrink-0" style={{ animationDelay: "0ms" }} />
              <span className="w-1 h-1 bg-black rounded-full animate-bounce shrink-0" style={{ animationDelay: "150ms" }} />
              <span className="w-1 h-1 bg-black rounded-full animate-bounce shrink-0" style={{ animationDelay: "300ms" }} />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Camera Viewfinder Retro-HUD Overlay Panel - FULL SCREEN as requested */}
      {isCameraActive && (
        <div className="absolute inset-0 bg-black z-50 flex flex-col justify-between p-4 font-pixel select-none">
          {/* Header retro stats bar */}
          <div className="flex justify-between items-center bg-black/55 px-3 py-1.5">
            <span className="text-[8px] text-sky-400">
              {capturedPhotoUrl ? "CAM_PHOTO_PREVIEW_MODE" : capturedVideoUrl ? "CAM_VIDEO_PREVIEW_MODE" : "CAM_RECORDER_ACTIVE"}
            </span>
            <span className="text-[8px] text-zinc-500">{capturedPhotoUrl || capturedVideoUrl ? "PREVIEW STATUS" : "100s LIMIT"}</span>
          </div>

          {/* Full Screen Interactive Viewfinder Box */}
          <div className="absolute inset-0 w-full h-full overflow-hidden flex items-center justify-center bg-zinc-950">
            {capturedPhotoUrl ? (
              <img
                src={capturedPhotoUrl}
                alt="Captured Snapshot"
                className="w-full h-full object-contain"
              />
            ) : capturedVideoUrl ? (
              <video
                src={capturedVideoUrl}
                autoPlay
                controls
                loop
                playsInline
                className="w-full h-full object-contain"
              />
            ) : (
              <video
                ref={cameraVideoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
                style={{ transform: isMirrored ? "scaleX(-1)" : "none" }}
              />
            )}
            {isRecordingVideo && (
              <div className="absolute top-16 left-4 bg-red-600/90 text-white text-[9px] p-2 px-3 border-2 border-black flex items-center gap-2 animate-pulse z-10">
                <span className="w-2.5 h-2.5 bg-white rounded-full" />
                <span>REC {formatRecordingTime(videoElapsed)} / 100s</span>
              </div>
            )}
            
            {/* Ambient Watermark HUD */}
            <div className="absolute top-16 right-4 text-white/50 text-[7px] text-right z-10 uppercase flex flex-col gap-0.5 pointer-events-none">
              <span>ORIENTATION: {isMirrored ? "RIGHT TO LEFT (MIRRORED)" : "LEFT TO RIGHT"}</span>
              <span>FPS: 30hz</span>
              {(capturedPhotoUrl || capturedVideoUrl) && <span className="text-yellow-400 font-bold">⚠️ WAITING ON DECISION</span>}
            </div>
          </div>
          
          {/* Camera Dashboard Bottom Controls Overlay */}
          <div className="bg-black/85 border-2 border-white p-3.5 flex flex-col gap-3.5 z-10 max-w-sm mx-auto w-full">
            <h3 className="text-[9px] text-pink-500 text-center uppercase tracking-wide">
              {capturedPhotoUrl 
                ? "👀 REVIEW CAPTURED PHOTO" 
                : capturedVideoUrl
                  ? "👀 REVIEW CAPTURED VIDEO"
                  : isRecordingVideo ? "📹 RECORDING VIDEO..." : "📷 FULL SCREEN DIGITAL CAMERA"}
            </h3>

            {/* Left to Right and Right to Left direct selectors - only visible when capturing */}
            {!capturedPhotoUrl && !capturedVideoUrl && (
              <div className="grid grid-cols-2 gap-2 border-b border-dashed border-zinc-700 pb-2.5">
                <button
                  type="button"
                  onClick={() => setIsMirrored(false)}
                  className={`p-2 border font-bold text-[8px] text-center flex items-center justify-center gap-1 cursor-pointer transition-all ${
                    !isMirrored 
                      ? "bg-green-500 text-white border-white scale-102" 
                      : "bg-zinc-900 text-zinc-400 border-zinc-700 hover:bg-zinc-800"
                  }`}
                >
                  ➡️ LEFT-TO-RIGHT
                </button>
                <button
                  type="button"
                  onClick={() => setIsMirrored(true)}
                  className={`p-2 border font-bold text-[8px] text-center flex items-center justify-center gap-1 cursor-pointer transition-all ${
                    isMirrored 
                      ? "bg-green-500 text-white border-white scale-102" 
                      : "bg-zinc-900 text-zinc-400 border-zinc-700 hover:bg-zinc-800"
                  }`}
                >
                  ⬅️ RIGHT-TO-LEFT
                </button>
              </div>
            )}

            <div className="flex gap-2.5 justify-center items-center">
              {capturedPhotoUrl ? (
                <>
                  <button
                    onClick={() => setCapturedPhotoUrl(null)}
                    className="p-3.5 bg-zinc-700 hover:bg-zinc-650 border-2 border-black text-[10px] sm:text-xs text-white font-bold flex items-center justify-center gap-1.5 cursor-pointer shadow-md uppercase font-pixel flex-1"
                  >
                    🔄 TAKE AGAIN
                  </button>
                  <button
                    onClick={() => sendCapturedPhoto(false)}
                    className="flex-[1.5] p-3.5 bg-green-500 hover:bg-green-455 border-2 border-black text-[10px] sm:text-xs text-white font-bold flex items-center justify-center gap-1.5 cursor-pointer shadow-md uppercase font-pixel"
                  >
                    📩 REGULAR
                  </button>
                  <button
                    onClick={() => sendCapturedPhoto(true)}
                    className="flex-[1.5] p-3.5 bg-purple-600 hover:bg-purple-550 border-2 border-white text-[10px] sm:text-xs text-white font-bold flex items-center justify-center gap-1.5 cursor-pointer shadow-md uppercase font-pixel animate-pulse"
                  >
                    🔏 ONCEVIEW
                  </button>
                </>
              ) : capturedVideoUrl ? (
                <>
                  <button
                    onClick={() => setCapturedVideoUrl(null)}
                    className="p-3.5 bg-zinc-700 hover:bg-zinc-650 border-2 border-black text-[10px] sm:text-xs text-white font-bold flex items-center justify-center gap-1.5 cursor-pointer shadow-md uppercase font-pixel flex-1"
                  >
                    🔄 RETAKE
                  </button>
                  <button
                    onClick={() => sendCapturedVideo(false)}
                    className="flex-[1.5] p-3.5 bg-green-500 hover:bg-green-455 border-2 border-black text-[10px] sm:text-xs text-white font-bold flex items-center justify-center gap-1.5 cursor-pointer shadow-md uppercase font-pixel"
                  >
                    📩 REGULAR
                  </button>
                  <button
                    onClick={() => sendCapturedVideo(true)}
                    className="flex-[1.5] p-3.5 bg-purple-600 hover:bg-purple-550 border-2 border-white text-[10px] sm:text-xs text-white font-bold flex items-center justify-center gap-1.5 cursor-pointer shadow-md uppercase font-pixel animate-pulse"
                  >
                    🔏 ONCEVIEW
                  </button>
                </>
              ) : !isRecordingVideo ? (
                <>
                  <button
                    onClick={snapPhoto}
                    className="flex-1 p-2.5 bg-sky-500 hover:bg-sky-450 border-2 border-black text-[9px] text-white font-bold flex items-center justify-center gap-1 cursor-pointer shadow-md animate-pulse"
                  >
                    📸 PHOTO
                  </button>
                  <button
                    onClick={startRecordingVideo}
                    className="flex-1 p-2.5 bg-red-500 hover:bg-red-450 border-2 border-black text-[9px] text-white font-bold flex items-center justify-center gap-1 cursor-pointer shadow-md"
                  >
                    🎥 VIDEO
                  </button>
                </>
              ) : (
                <button
                  onClick={stopRecordingVideo}
                  className="flex-1 p-2.5 bg-pink-600 hover:bg-pink-500 border-2 border-black text-[9px] text-white font-bold flex items-center justify-center gap-1.5 cursor-pointer animate-pulse shrink-0"
                >
                  ⏹️ STOP & REVIEW VIDEO
                </button>
              )}
              
              {!capturedPhotoUrl && !capturedVideoUrl && (
                <button
                  onClick={stopCamera}
                  disabled={isRecordingVideo}
                  className="p-2.5 bg-zinc-800 hover:bg-zinc-700 border-2 border-zinc-650 text-[9px] text-white font-bold cursor-pointer disabled:opacity-50 shrink-0"
                >
                  CANCEL
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Hidden File System Selector */}
      <input
        type="file"
        id="camera-filesystem-upload"
        accept="image/*,video/*"
        onChange={handleFileSystemUpload}
        className="hidden"
      />

      <div className="bg-sky-200 border-t-4 border-black p-4 absolute bottom-0 left-0 right-0 z-20">
        {/* Reply Quoting Banner */}
        {replyTo && (
          <div className="mb-1 bg-pink-100 p-1.5 px-2 border border-black flex justify-between items-center text-[9px] sm:text-[10px] text-black">
            <div className="flex flex-col text-left gap-0.5">
              <span className="font-pixel text-[7px] text-sky-600 tracking-wider">↩️ REPLYING TO @{replyTo.userName}</span>
              <span className="font-pixel text-[8px] text-gray-500 truncate max-w-[190px]">
                {replyTo.audioUrl ? "🎤 Voice note" : replyTo.imageUrl ? "🖼️ Shared sticker/image" : replyTo.videoUrl ? "🎥 Mini Video" : replyTo.text}
              </span>
            </div>
            <button
              onClick={() => setReplyTo(null)}
              className="bg-red-500 hover:bg-red-400 text-white font-pixel text-[7px] p-1 px-1.5 pixel-border-sm cursor-pointer"
            >
              CANCEL
            </button>
          </div>
        )}

        {/* Stickers Drawer */}
        {showStickers && (
          <div className="mb-1.5 bg-white pixel-border-sm p-1.5 grid grid-cols-3 gap-1.5 overflow-y-auto max-h-36">
            {STICKERS.map((stickerUrl, idx) => (
              <img 
                key={idx}
                src={stickerUrl}
                alt={`Sticker ${idx}`}
                className="w-full h-12 object-cover cursor-pointer hover:bg-sky-100 pixel-border-sm bg-sky-50"
                onClick={() => sendSticker(stickerUrl)}
              />
            ))}
          </div>
        )}

        {/* Attach Menu Drawer for direct files and cameras */}
        {showAttachMenu && (
          <div className="mb-1.5 bg-sky-950 p-2 border-2 border-black grid grid-cols-3 gap-2 text-white shadow-xl">
            <button
              type="button"
              onClick={() => {
                document.getElementById("camera-filesystem-upload")?.click();
                setShowAttachMenu(false);
              }}
              className="p-2 border border-sky-700 bg-sky-900 hover:bg-sky-800 text-[8px] font-pixel flex flex-col items-center justify-center gap-1 cursor-pointer transition-colors"
            >
              <Paperclip size={14} className="text-yellow-300" />
              <span>FILESYSTEM</span>
            </button>
            <button
              type="button"
              onClick={startCamera}
              className="p-2 border border-sky-700 bg-sky-900 hover:bg-sky-800 text-[8px] font-pixel flex flex-col items-center justify-center gap-1 cursor-pointer transition-colors"
            >
              <Camera size={14} className="text-pink-400" />
              <span>LIVE CAM</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setShowImageInput(true);
                setShowAttachMenu(false);
              }}
              className="p-2 border border-sky-700 bg-sky-900 hover:bg-sky-800 text-[8px] font-pixel flex flex-col items-center justify-center gap-1 cursor-pointer transition-colors"
            >
              <ImageIcon size={14} className="text-sky-300" />
              <span>PASTE LINK</span>
            </button>
          </div>
        )}
        
        {showImageInput && (
          <div className="mb-2 flex gap-1">
            <input
              type="text"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="Paste GIF or image URL..."
              className="flex-1 p-1 bg-sky-50 pixel-border-sm text-sm outline-none"
            />
            <button
              onClick={() => setShowImageInput(false)}
              className="bg-black text-white px-2 font-pixel text-[10px] pixel-border-sm hover:text-pink-400"
            >
              X
            </button>
          </div>
        )}

        {isRecording ? (
          <div className="flex gap-2.5 items-center bg-sky-950 text-white p-2.5 sm:p-3.5 border-4 border-black shadow-lg">
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              <span className="w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse shrink-0" />
              <span className="font-pixel text-[8px] text-red-400 shrink-0">REC {formatRecordingTime(recordingTime)}</span>
              
              {/* Animated Waveform Blocks */}
              <div className="flex gap-[1px] items-end h-5 ml-1.5 overflow-hidden flex-1">
                {Array.from({ length: 14 }).map((_, idx) => {
                  const delay = (idx % 4) * 0.15;
                  const randomHeight = 35 + (idx % 3) * 20 + Math.random() * 20;
                  return (
                    <div
                      key={idx}
                      className="w-[3px] bg-pink-500 rounded-t shrink-0"
                      style={{
                        height: `${randomHeight}%`,
                        animationName: "pulse",
                        animationDuration: "0.8s",
                        animationIterationCount: "infinite",
                        animationTimingFunction: "ease-in-out",
                        animationDelay: `${delay}s`
                      }}
                    />
                  );
                })}
              </div>
            </div>

            <div className="flex gap-2 shrink-0">
              <button
                type="button"
                onClick={() => stopRecording(false)}
                className="bg-zinc-900 hover:bg-red-950 border-2 border-red-500 p-2 sm:p-2.5 px-3 flex items-center justify-center gap-1.5 cursor-pointer pixel-border-sm shadow-md"
                title="Cancel Recording"
              >
                <X size={14} className="stroke-[3.5px] text-red-500 shrink-0" />
                <span className="font-pixel text-[8px] sm:text-[9px] text-red-400 font-bold hidden sm:inline">CUT / RETAKE</span>
              </button>
              <button
                type="button"
                onClick={() => stopRecording(true)}
                className="bg-green-600 hover:bg-green-500 border-2 border-white p-2 sm:p-2.5 px-3 flex items-center justify-center gap-1.5 cursor-pointer pixel-border-sm shadow-md"
                title="Send Voice Note"
              >
                <Check size={14} className="stroke-[3.5px] text-white shrink-0" />
                <span className="font-pixel text-[8px] sm:text-[9px] text-white font-bold">SEND / TIK</span>
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSend} className="flex gap-1">
            <button
              type="button"
              onClick={() => {
                setShowStickers(!showStickers);
                setShowAttachMenu(false);
                setShowImageInput(false);
              }}
              className={`p-2.5 bg-white pixel-border-sm hover:bg-sky-50 transition-colors shrink-0 ${
                showStickers ? "bg-pink-300" : ""
              }`}
              title="Send Sticker"
            >
              <Smile size={20} className="stroke-[2.5px] text-pink-500" />
            </button>
            <button
              type="button"
              onClick={() => {
                setShowAttachMenu(!showAttachMenu);
                setShowStickers(false);
                setShowImageInput(false);
              }}
              className={`p-2.5 bg-white pixel-border-sm hover:bg-sky-50 transition-colors shrink-0 ${
                showAttachMenu ? "bg-sky-300" : ""
              }`}
              title="Attach File / Live Camera"
            >
              <Paperclip size={20} className="stroke-[2.5px] text-sky-500" />
            </button>
            
            <button
              type="button"
              onClick={startRecording}
              className="p-2.5 bg-white pixel-border-sm hover:bg-red-50 text-red-500 transition-colors shrink-0"
              title="Record Voice Note"
            >
              <Mic size={20} className="stroke-[2.5px]" />
            </button>

            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Type message..."
              className="flex-1 p-2 bg-white pixel-border-sm focus:bg-sky-50 transition-colors text-lg min-w-0"
            />
            <button
              type="submit"
              disabled={!text.trim()}
              className="p-2.5 bg-pink-500 text-white pixel-border-sm hover:bg-pink-400 disabled:opacity-50 shrink-0 transition-all cursor-pointer"
            >
              <Send size={20} className="stroke-[2.5px]" />
            </button>
          </form>
        )}
      </div>

      {/* Dynamic Full Screen Image / Video Lightbox Overlay, with Pixel Borders */}
      {viewerMedia && (
        <div 
          className="absolute inset-0 bg-black/95 z-50 flex flex-col justify-between p-4"
          onClick={() => setViewerMedia(null)}
        >
          {/* Header Bar */}
          <div className="flex justify-between items-center w-full z-10 p-2 bg-black/55 border border-dashed border-gray-700">
            <span className="font-pixel text-[8px] sm:text-[10px] text-pink-500 uppercase">
              🖼️ FULL SCREEN VIEW
            </span>
            <div className="flex gap-2">
              {viewerMedia.isMine && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteMessage(viewerMedia.id);
                    setViewerMedia(null);
                  }}
                  className="p-1 px-2.5 bg-red-600 hover:bg-red-500 text-white font-pixel text-[8px] sm:text-[9px] pixel-border-sm cursor-pointer flex items-center gap-1 uppercase"
                  title="Delete Media File"
                >
                  <Trash2 size={10} className="stroke-[3px]" /> DELETE
                </button>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setViewerMedia(null);
                }}
                className="p-1 px-2 text-white bg-black hover:bg-zinc-800 border-2 border-white font-pixel text-[8px] sm:text-[9px] cursor-pointer"
              >
                CLOSE [X]
              </button>
            </div>
          </div>

          {/* Media Container with absolute pixel borders */}
          <div className="flex-1 flex items-center justify-center p-3 sm:p-6" onClick={(e) => e.stopPropagation()}>
            <div className="relative pixel-border max-w-full max-h-[75vh] bg-black p-2 flex items-center justify-center overflow-hidden w-full h-[65vh]">
              {viewerMedia.type === "image" ? (
                <img
                  src={viewerMedia.url}
                  alt="Full view"
                  className="max-w-full max-h-[60vh] object-contain object-center pixel-border-sm mx-auto"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <video
                  src={viewerMedia.url}
                  controls
                  autoPlay
                  className="max-w-full max-h-[60vh] object-contain bg-black pixel-border-sm mx-auto w-full h-full"
                />
              )}
            </div>
          </div>

          {/* Footer pixel decoration */}
          <div className="text-center font-pixel text-[6px] sm:text-[8px] text-zinc-500 uppercase select-none pb-4">
            USE BORDER PIXELS • TAP ANYWHERE TO CLOSE
          </div>
        </div>
      )}
    </div>
  );
}

interface SwipeableMessageProps {
  children: React.ReactNode;
  onSwipeReply: () => void;
  isDisabled?: boolean;
}

const SwipeableMessage: React.FC<SwipeableMessageProps> = ({
  children,
  onSwipeReply,
  isDisabled,
}) => {
  if (isDisabled) return <>{children}</>;

  const swipeRef = useRef<HTMLDivElement>(null);
  const [startX, setStartX] = useState(0);
  const [dragX, setDragX] = useState(0);

  const handleTouchStart = (e: React.TouchEvent) => {
    setStartX(e.touches[0].clientX);
    setDragX(0);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const currentX = e.touches[0].clientX;
    const diff = currentX - startX;
    // Only allow pulling to the right (WhatsApp style reply gesture)
    if (diff > 0) {
      setDragX(Math.min(diff, 80));
    }
  };

  const handleTouchEnd = () => {
    if (dragX > 50) {
      onSwipeReply();
    }
    setDragX(0);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    setStartX(e.clientX);
    setDragX(0);

    const onMouseMove = (moveEvent: MouseEvent) => {
      const diff = moveEvent.clientX - e.clientX;
      if (diff > 0) {
        setDragX(Math.min(diff, 80));
      }
    };

    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      if (dragX > 50) {
        onSwipeReply();
      }
      setDragX(0);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  return (
    <div
      ref={swipeRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onMouseDown={handleMouseDown}
      style={{
        transform: `translateX(${dragX}px)`,
        transition: dragX === 0 ? "transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.127)" : "none",
      }}
      className="relative select-none w-full flex flex-col group transition-all"
    >
      {dragX > 15 && (
        <div 
          className="absolute left-[-45px] top-1/2 -translate-y-1/2 font-pixel text-[12px] text-pink-500 bg-white border border-black p-1 py-1.5 shadow-[1px_1px_0_0_#000] z-20"
          style={{ opacity: Math.min(dragX / 40, 1) }}
        >
          💬 REPLY
        </div>
      )}
      {children}
    </div>
  );
}

function MessageEmptyIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-sky-400">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
  );
}
