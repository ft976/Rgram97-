import { useState, useEffect, useRef } from "react";
import { User, ChatMessage } from "@/src/types";
import { Chat } from "./Chat";
import { io, Socket } from "socket.io-client";
import { Users, LogOut } from "lucide-react";
import {
  playDialTone,
  playRingCallback,
  playIncomingRing,
  playConnectSound,
  playDisconnectSound
} from "@/src/lib/sounds";

function sendBrowserNotification(title: string, body: string, iconUrl?: string) {
  if (!("Notification" in window)) return;
  if (Notification.permission === "granted") {
    new Notification(title, {
      body,
      icon: iconUrl || "https://api.dicebear.com/7.x/pixel-art/svg?seed=pixelgram_logo",
    });
  } else if (Notification.permission !== "denied") {
    Notification.requestPermission().then((permission) => {
      if (permission === "granted") {
        new Notification(title, {
          body,
          icon: iconUrl || "https://api.dicebear.com/7.x/pixel-art/svg?seed=pixelgram_logo",
        });
      }
    });
  }
}

export function Room({ roomId, currentUser, onLeave }: { roomId: string; currentUser: User; onLeave: () => void }) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [typingUsers, setTypingUsers] = useState<Record<string, string>>({});

  // Call States
  const [callState, setCallState] = useState<"idle" | "ringing_out" | "ringing_in" | "connected">("idle");
  const [callType, setCallType] = useState<"audio" | "video">("audio");
  const [peerUser, setPeerUser] = useState<User | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [callDuration, setCallDuration] = useState(0);

  // References
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const callTimerRef = useRef<any>(null);
  const ringIntervalRef = useRef<any>(null);
  const ringingTimeoutRef = useRef<any>(null);
  
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);

  // Request notification permission on mount
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    // Connect to same origin server
    const newSocket = io("/");
    setSocket(newSocket);
    
    newSocket.on("connect", () => {
      newSocket.emit("join_room", { roomId, user: currentUser });
    });

    newSocket.on("room_state", (state: { users: User[]; messages: ChatMessage[] }) => {
      setUsers(state.users);
      setMessages(state.messages);
    });

    newSocket.on("user_joined", (user: User) => {
      setUsers((prev) => {
        if (prev.find(u => u.id === user.id)) return prev;
        return [...prev, user];
      });
    });

    newSocket.on("new_message", (message: ChatMessage) => {
      setMessages((prev) => [...prev, message]);

      // Chrome native notification
      if (message.userId !== currentUser.id) {
        let content = message.text || "";
        if (message.audioUrl) {
          content = "🎤 Sent a Voice note";
        } else if (message.imageUrl) {
          content = "🖼️ Shared an Image";
        }
        sendBrowserNotification(
          `📬 ${message.userName || "Room Visitor"}`,
          content,
          message.userAvatarUrl
        );
      }
    });

    newSocket.on("message_deleted", (messageId: string) => {
      setMessages((prev) => prev.map((m) => m.id === messageId ? { ...m, isDeleted: true, text: "MESSAGE_UNSENT", imageUrl: undefined, videoUrl: undefined, audioUrl: undefined } : m));
    });

    newSocket.on("message_hidden_for_me", (messageId: string) => {
      setMessages((prev) => prev.map((m) => {
          if (m.id === messageId) {
              const hiddenFor = m.hiddenFor || [];
              if (!hiddenFor.includes(currentUser.id)) {
                  return { ...m, hiddenFor: [...hiddenFor, currentUser.id] };
              }
          }
          return m;
      }));
    });

    newSocket.on("message_updated", (updated: ChatMessage) => {
      setMessages((prev) => prev.map((m) => m.id === updated.id ? updated : m));
    });

    newSocket.on("user_typing_update", ({ userId, userName, isTyping }) => {
      setTypingUsers((prev) => {
        const copy = { ...prev };
        if (isTyping) {
          copy[userId] = userName;
        } else {
          delete copy[userId];
        }
        return copy;
      });
    });

    // Call Sockets Coordination
    newSocket.on("incoming_call", ({ caller, type }) => {
      setPeerUser(caller);
      setCallType(type);
      setCallState("ringing_in");

      playIncomingRing();
      if (ringIntervalRef.current) clearInterval(ringIntervalRef.current);
      ringIntervalRef.current = setInterval(() => {
        playIncomingRing();
      }, 2000);

      // Trigger Chrome native notification
      sendBrowserNotification(
        `🔔 INCOMING ${type.toUpperCase()} CALL`,
        `${caller.name} is calling you!`,
        caller.avatarUrl
      );
    });

    newSocket.on("call_answered", ({ callee }) => {
      if (ringIntervalRef.current) clearInterval(ringIntervalRef.current);
      playConnectSound();
      setCallState("connected");
      initializeWebRTC(true, callType);

      setCallDuration(0);
      callTimerRef.current = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
    });

    newSocket.on("call_declined", () => {
      playDisconnectSound();
      resetCallState();
    });

    newSocket.on("call_ended", () => {
      playDisconnectSound();
      resetCallState();
    });

    newSocket.on("webrtc_signal", async ({ signal, senderId }) => {
      if (senderId === currentUser.id) return;
      const pc = pcRef.current;
      if (!pc) return;

      try {
        if (signal.sdp) {
          await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
          if (pc.remoteDescription?.type === "offer") {
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            newSocket.emit("webrtc_signal", {
              roomId,
              signal: { sdp: answer },
              senderId: currentUser.id
            });
          }
        } else if (signal.candidate) {
          await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
        }
      } catch (err) {
        console.warn("WebRTC Signal parsing failed:", err);
      }
    });

    return () => {
      newSocket.disconnect();
      if (callTimerRef.current) clearInterval(callTimerRef.current);
      if (ringIntervalRef.current) clearInterval(ringIntervalRef.current);
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, [roomId, currentUser]);

  // Handle active stream attachments dynamically using reliable callback-refs
  const handleLocalVideoRef = (el: HTMLVideoElement | null) => {
    localVideoRef.current = el;
    if (el && localStream) {
      el.srcObject = localStream;
      el.play().catch((err) => console.warn("Local play failed:", err));
    }
  };

  const handleRemoteVideoRef = (el: HTMLVideoElement | null) => {
    remoteVideoRef.current = el;
    if (el && remoteStream) {
      el.srcObject = remoteStream;
      el.play().catch((err) => console.warn("Remote play failed:", err));
    }
  };

  // WebRTC setup and track addition
  const initializeWebRTC = async (isCaller: boolean, type: "audio" | "video") => {
    try {
      const constraints = {
        audio: true,
        video: type === "video" ? { width: 320, height: 240, frameRate: 15 } : false
      };
      
      let stream: MediaStream | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        setLocalStream(stream);
        localStreamRef.current = stream;
      } catch (mediaErr) {
        console.warn("System cameras/microphone block or missing. Showing interactive animated dashboard:", mediaErr);
      }

      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
      });
      pcRef.current = pc;

      if (stream) {
        stream.getTracks().forEach((track) => {
          pc.addTrack(track, stream!);
        });
      }

      pc.ontrack = (event) => {
        if (event.streams && event.streams[0]) {
          setRemoteStream(event.streams[0]);
        }
      };

      pc.onicecandidate = (event) => {
        if (event.candidate && socket) {
          socket.emit("webrtc_signal", {
            roomId,
            signal: { candidate: event.candidate },
            senderId: currentUser.id
          });
        }
      };

      if (isCaller) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        if (socket) {
          socket.emit("webrtc_signal", {
            roomId,
            signal: { sdp: offer },
            senderId: currentUser.id
          });
        }
      }
    } catch (e) {
      console.warn("WebRTC setup error:", e);
    }
  };

  const resetCallState = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
    }
    setLocalStream(null);
    localStreamRef.current = null;
    setRemoteStream(null);

    if (pcRef.current) {
      pcRef.current.close();
    }
    pcRef.current = null;

    if (callTimerRef.current) clearInterval(callTimerRef.current);
    if (ringIntervalRef.current) clearInterval(ringIntervalRef.current);
    if (ringingTimeoutRef.current) clearTimeout(ringingTimeoutRef.current);

    setCallState("idle");
    setPeerUser(null);
    setCallDuration(0);
    setIsMuted(false);
    setIsVideoOff(false);
  };

  const handleInitiateCall = (type: "audio" | "video") => {
    if (!socket) return;
    
    const other = users.find((u) => u.id !== currentUser.id) || null;
    setPeerUser(other);
    setCallType(type);
    setCallState("ringing_out");

    playDialTone();
    if (ringIntervalRef.current) clearInterval(ringIntervalRef.current);
    ringIntervalRef.current = setInterval(() => {
      playRingCallback();
    }, 2500);

    socket.emit("initiate_call", { roomId, caller: currentUser, type });
  };

  const handleAcceptCall = () => {
    if (!socket) return;
    if (ringIntervalRef.current) clearInterval(ringIntervalRef.current);
    playConnectSound();
    setCallState("connected");
    socket.emit("answer_call", { roomId, callee: currentUser });
    initializeWebRTC(false, callType);

    setCallDuration(0);
    callTimerRef.current = setInterval(() => {
      setCallDuration((prev) => prev + 1);
    }, 1000);
  };

  const handleDeclineCall = () => {
    if (!socket) return;
    if (ringIntervalRef.current) clearInterval(ringIntervalRef.current);
    playDisconnectSound();
    socket.emit("decline_call", { roomId, callee: currentUser });
    resetCallState();
  };

  const handleEndCall = () => {
    if (!socket) return;
    playDisconnectSound();
    socket.emit("end_call", { roomId, user: currentUser });
    resetCallState();
  };

  useEffect(() => {
    if (ringingTimeoutRef.current) {
      clearTimeout(ringingTimeoutRef.current);
      ringingTimeoutRef.current = null;
    }

    if (callState === "ringing_in" || callState === "ringing_out") {
      ringingTimeoutRef.current = setTimeout(() => {
        console.log("Ringing limit 90s exceeded. Auto-terminating call.");
        if (callState === "ringing_in") {
          handleDeclineCall();
        } else {
          handleEndCall();
        }
      }, 90000);
    }

    return () => {
      if (ringingTimeoutRef.current) {
        clearTimeout(ringingTimeoutRef.current);
      }
    };
  }, [callState]);

  const handleSendMessage = (text: string, imageUrl?: string, audioUrl?: string, videoUrl?: string, replyTo?: ChatMessage["replyTo"], isViewOnce?: boolean, customUserId?: string, customUserName?: string) => {
    if (!socket) return;
    const message: ChatMessage = {
      id: Math.random().toString(36).substring(2, 9),
      userId: customUserId || currentUser.id,
      userName: customUserName || currentUser.name,
      userAvatarUrl: customUserId ? "" : currentUser.avatarUrl,
      text,
      imageUrl,
      audioUrl,
      videoUrl,
      timestamp: Date.now(),
      replyTo,
      isViewOnce,
      isOpened: false,
    };
    socket.emit("send_message", { roomId, message });
  };

  const handleViewMessage = (messageId: string) => {
    if (!socket) return;
    socket.emit("view_message", { roomId, messageId });
  };

  const handleDeleteMessage = (messageId: string) => {
    if (!socket) return;
    socket.emit("delete_message", { roomId, messageId });
  };

  const handleDeleteForMe = (messageId: string) => {
    if (!socket) return;
    socket.emit("delete_message_for_me", { roomId, messageId, userId: currentUser.id });
  };

  return (
    <div className="flex flex-col h-screen max-w-md mx-auto bg-white pixel-border sm:my-4 sm:h-[calc(100vh-2rem)] overflow-hidden shadow-2xl relative">
      {/* Top Bar */}
      <div className="bg-sky-505 bg-sky-500 p-2 sm:p-3 border-b-4 border-black flex justify-between items-center z-20 shrink-0 shadow-sm">
        <h1 className="font-pixel text-lg text-white pixel-text-shadow">
          ROOM:{roomId}
        </h1>
        <div className="flex gap-4 items-center">
          <div className="flex items-center gap-1 bg-yellow-400 px-2 py-1 pixel-border-sm text-black" title="Online Users">
            <Users size={16} />
            <span className="font-pixel text-xs">{users.length}</span>
          </div>
          <button onClick={onLeave} className="hover:text-red-500 transition-colors bg-white text-black p-1 pixel-border-sm cursor-pointer" title="Leave Room">
            <LogOut size={16} className="stroke-[3px]" />
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden relative">
        <Chat
          messages={messages}
          onSendMessage={handleSendMessage}
          onDeleteMessage={handleDeleteMessage}
          onDeleteForMe={handleDeleteForMe}
          currentUser={currentUser}
          onInitiateCall={handleInitiateCall}
          onViewMessage={handleViewMessage}
          onTypingChange={(isTyping) => {
            if (socket) {
              socket.emit("user_typing", {
                roomId,
                userId: currentUser.id,
                userName: currentUser.name,
                isTyping,
              });
            }
          }}
          typingUsers={typingUsers}
        />
      </div>

      {/* === CALL DIALING OUT OVERLAY === */}
      {callState === "ringing_out" && (
        <div className="absolute inset-0 bg-sky-950/95 z-50 flex flex-col items-center justify-center p-4 text-white">
          <div className="bg-sky-900 border-4 border-black p-6 w-full max-w-xs text-center flex flex-col gap-4 shadow-[6px_6px_0_0_#db2777]">
            <h2 className="font-pixel text-yellow-300 text-sm animate-pulse">DIALING...</h2>
            
            <div className="flex justify-center my-2">
              <img
                src={peerUser?.avatarUrl || `https://api.dicebear.com/7.x/pixel-art/svg?seed=${roomId}`}
                alt="Avatar"
                className="w-20 h-20 pixel-border border-4 border-dashed border-sky-400 bg-black animate-bounce"
              />
            </div>

            <p className="font-pixel text-[10px] text-sky-200">CALLING</p>
            <p className="font-pixel text-xs text-pink-400">{peerUser?.name || "Pixel Room"}</p>

            <div className="flex justify-center gap-1 my-1">
              <span className="w-2 h-2 bg-pink-500 rounded-full animate-ping" />
              <span className="w-2 h-2 bg-yellow-400 rounded-full animate-ping delay-75" />
              <span className="w-2 h-2 bg-sky-400 rounded-full animate-ping delay-150" />
            </div>

            <button
              onClick={handleDeclineCall}
              className="mt-2 bg-red-600 hover:bg-red-500 text-white font-pixel text-xs p-3 pixel-border cursor-pointer transition-all active:translate-y-0.5"
            >
              CANCEL
            </button>
          </div>
        </div>
      )}

      {/* === INCOMING CALL RINGING IN OVERLAY === */}
      {callState === "ringing_in" && (
        <div className="absolute inset-0 bg-sky-950/95 z-50 flex flex-col items-center justify-center p-4 text-white">
          <div className="bg-sky-900 border-4 border-black p-5 w-full max-w-xs text-center flex flex-col gap-4 shadow-[6px_6px_0_0_#db2777]">
            <h2 className="font-pixel text-pink-400 text-xs animate-pulse">🔔 INCOMING {callType === "video" ? "VIDEO" : "VOICE"} CALL</h2>
            
            <div className="flex justify-center my-2">
              <img
                src={peerUser?.avatarUrl || `https://api.dicebear.com/7.x/pixel-art/svg?seed=placeholder`}
                alt="Caller Avatar"
                className="w-20 h-20 pixel-border border-4 border-dashed border-green-400 bg-black animate-pulse"
              />
            </div>

            <p className="font-pixel text-xs text-yellow-300">{peerUser?.name || "Pixel Guest"}</p>
            <p className="font-pixel text-[6px] sm:text-[8px] text-sky-200">WANTS TO CONNECT</p>

            <div className="flex gap-4 justify-center mt-2">
              <button
                onClick={handleDeclineCall}
                className="bg-red-600 hover:bg-red-500 text-white font-pixel text-[10px] p-2 px-4 pixel-border cursor-pointer transition-all active:translate-y-0.5"
              >
                DECLINE
              </button>
              <button
                onClick={handleAcceptCall}
                className="bg-green-500 hover:bg-green-400 text-white font-pixel text-[10px] p-2 px-4 pixel-border cursor-pointer transition-all active:translate-y-0.5"
              >
                ACCEPT
              </button>
            </div>
          </div>
        </div>
      )}

      {/* === ACTIVE CONNECTED OVERLAY === */}
      {callState === "connected" && (
        <div className="absolute inset-0 bg-black/95 z-50 flex flex-col p-4 text-white select-none">
          {/* Scanlines Effect */}
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[size:100%_4px,3px_100%] z-20" />
          
          <div className="flex justify-between items-center text-center pb-2 border-b-2 border-dashed border-sky-800 shrink-0">
            <span className="font-pixel text-[8px] text-sky-400">CONNECT STATUS: ACTIVE</span>
            <span className="font-pixel text-[10px] text-yellow-300 bg-sky-950 px-2.5 py-1 pixel-border-sm shrink-0">
              ⏱️ {Math.floor(callDuration / 60)}:{(callDuration % 60) < 10 ? "0" : ""}{callDuration % 60}
            </span>
          </div>

          <div className="flex-1 flex flex-col justify-center items-center my-3 gap-2 overflow-hidden relative">
            {callType === "video" ? (
              <div className="w-full h-full flex flex-col gap-2 relative">
                <div className="flex-1 bg-sky-950 pixel-border flex items-center justify-center overflow-hidden relative">
                  {remoteStream && !isVideoOff ? (
                    <video
                      ref={handleRemoteVideoRef}
                      autoPlay
                      playsInline
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-2">
                      <img
                        src={peerUser?.avatarUrl || "https://api.dicebear.com/7.x/pixel-art/svg?seed=remote"}
                        alt="Remote Avatar"
                        className="w-16 h-16 pixel-border bg-black"
                      />
                      <span className="font-pixel text-[10px] text-yellow-400">{peerUser?.name || "Companion"} (No Video)</span>
                    </div>
                  )}
                  <span className="absolute bottom-2 left-2 font-pixel text-[8px] text-sky-400 bg-black/70 px-1">REMOTE</span>
                </div>

                <div className="absolute top-2 right-2 w-24 h-32 bg-sky-900 border-2 border-black overflow-hidden flex items-center justify-center z-10 shadow-lg">
                  {localStream ? (
                    <video
                      ref={handleLocalVideoRef}
                      muted
                      autoPlay
                      playsInline
                      className="w-full h-full object-cover scale-x-[-1]"
                    />
                  ) : (
                    <img
                      src={currentUser.avatarUrl}
                      alt="My Avatar"
                      className="w-8 h-8 pixel-border bg-black"
                    />
                  )}
                  <span className="absolute bottom-1 right-1 font-pixel text-[6px] text-pink-400 bg-black/60 px-1">ME</span>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center gap-6 py-6 w-full">
                <div className="flex gap-8 items-center justify-center">
                  <div className="flex flex-col items-center gap-1.5">
                    <img
                      src={currentUser.avatarUrl}
                      alt="My Avatar"
                      className={`w-14 h-14 pixel-border bg-black border-2 border-pink-500 ${isMuted ? "" : "animate-pulse"}`}
                    />
                    <span className="font-pixel text-[8px] text-pink-400">ME</span>
                  </div>

                  <div className="flex gap-0.5 items-end h-8 overflow-hidden w-20 justify-center">
                    {Array.from({ length: 12 }).map((_, idx) => {
                      const h = 20 + Math.floor(Math.random() * (isMuted ? 10 : 70));
                      return (
                        <div
                          key={idx}
                          className="w-1.5 bg-green-500 rounded-t shrink-0 animate-pulse"
                          style={{ height: `${h}%`, animationDelay: `${idx * 0.1}s` }}
                        />
                      );
                    })}
                  </div>

                  <div className="flex flex-col items-center gap-1.5">
                    <img
                      src={peerUser?.avatarUrl || "https://api.dicebear.com/7.x/pixel-art/svg?seed=connected"}
                      alt="Partner Avatar"
                      className="w-14 h-14 pixel-border bg-black border-2 border-sky-400 animate-pulse"
                    />
                    <span className="font-pixel text-[8px] text-sky-400">{peerUser?.name || "Companion"}</span>
                  </div>
                </div>

                <div className="bg-sky-950/80 p-2 border-2 border-dashed border-sky-800 text-center font-pixel text-[8px] text-green-400 w-full max-w-[200px]">
                  SYNCHRONIZED VOICE CHANNEL
                </div>
              </div>
            )}
          </div>

          {/* Controls Bar */}
          <div className="flex gap-4 justify-center items-center py-2 border-t-2 border-dashed border-sky-800 shrink-0">
            <button
              onClick={() => {
                if (localStreamRef.current) {
                  const audioTrack = localStreamRef.current.getAudioTracks()[0];
                  if (audioTrack) {
                    audioTrack.enabled = !audioTrack.enabled;
                    setIsMuted(!audioTrack.enabled);
                  }
                } else {
                  setIsMuted(!isMuted);
                }
              }}
              className={`p-2.5 pixel-border-sm hover:opacity-85 text-xs font-pixel cursor-pointer transition-all ${
                isMuted ? "bg-red-500 text-white" : "bg-white text-black"
              }`}
              title={isMuted ? "Unmute Mic" : "Mute Mic"}
            >
              🎤 {isMuted ? "MUTED" : "ON"}
            </button>

            <button
              onClick={handleEndCall}
              className="bg-red-600 hover:bg-red-500 text-white font-pixel text-xs p-2.5 px-6 pixel-border cursor-pointer transition-all active:translate-y-0.5"
              title="Hang Up"
            >
              HANG UP
            </button>

            {callType === "video" && (
              <button
                onClick={() => {
                  if (localStreamRef.current) {
                    const videoTrack = localStreamRef.current.getVideoTracks()[0];
                    if (videoTrack) {
                      videoTrack.enabled = !videoTrack.enabled;
                      setIsVideoOff(!videoTrack.enabled);
                    }
                  } else {
                    setIsVideoOff(!isVideoOff);
                  }
                }}
                className={`p-2.5 pixel-border-sm hover:opacity-85 text-xs font-pixel cursor-pointer transition-all ${
                  isVideoOff ? "bg-red-500 text-white" : "bg-white text-black"
                }`}
                title={isVideoOff ? "Turn Cam On" : "Turn Cam Off"}
              >
                📷 {isVideoOff ? "OFF" : "ON"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
