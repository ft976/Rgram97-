import React, { useState, useEffect } from "react";
import { RoomInfo, User } from "@/src/types";
import { User as UserIcon, Trash2, ArrowRight, UserPlus, Check } from "lucide-react";
import { io, Socket } from "socket.io-client";

export function Home({
  currentUser,
  myRooms,
  onJoinRoom,
  onDeleteRoom,
  onEditProfile,
}: {
  currentUser: User;
  myRooms: RoomInfo[];
  onJoinRoom: (roomId: string) => void;
  onDeleteRoom: (roomId: string) => void;
  onEditProfile: () => void;
}) {
  const [roomCode, setRoomCode] = useState("");
  const [roomToDelete, setRoomToDelete] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  
  // Lobby states
  const [socket, setSocket] = useState<Socket | null>(null);
  const [onlineUsers, setOnlineUsers] = useState<User[]>([]);
  const [friends, setFriends] = useState<User[]>([]);
  const [friendRequests, setFriendRequests] = useState<Array<{senderId: string, senderUser: User}>>([]);
  const [selectedFriend, setSelectedFriend] = useState<User | null>(null);
  const [searchUser, setSearchUser] = useState("");
  const [currentView, setCurrentView] = useState<"rooms" | "inbox">("rooms");

  useEffect(() => {
    const newSocket = io("/");
    setSocket(newSocket);

    newSocket.on("connect", () => {
      newSocket.emit("join_lobby", { user: currentUser });
    });

    newSocket.on("lobby_init", (data: { onlineUsers: User[], friends: User[], pendingRequests: Array<{senderId: string, senderUser: User}> }) => {
      setOnlineUsers(data.onlineUsers.filter(u => u.id !== currentUser.id));
      setFriends(data.friends);
      setFriendRequests(data.pendingRequests);
    });

    newSocket.on("update_online_users", (users) => {
      setOnlineUsers(users.filter((u: User) => u.id !== currentUser.id));
    });

    newSocket.on("new_friend_request", (data: {senderId: string, senderUser: User}) => {
      setFriendRequests((prev) => {
          if (prev.find(r => r.senderId === data.senderId)) return prev;
          return [...prev, data];
      });
    });

    newSocket.on("friend_accepted", (newFriend: User) => {
        setFriends(prev => {
            if (prev.find(f => f.id === newFriend.id)) return prev;
            return [...prev, newFriend];
        });
        // Also remove from pending if it was there
        setFriendRequests(prev => prev.filter(r => r.senderId !== newFriend.id));
    });

    return () => {
      newSocket.disconnect();
    };
  }, [currentUser]);

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomCode.trim()) return;
    onJoinRoom(roomCode.trim().toUpperCase());
  };

  const handleAddFriend = (targetUserId: string) => {
    if (!socket) return;
    socket.emit("send_friend_request", { senderId: currentUser.id, receiverId: targetUserId, senderUser: currentUser });
  };

  const handleStartChat = (friend: User) => {
    // DM room naming: DM-id1-id2 (sorted)
    const roomId = [currentUser.id, friend.id].sort().sort((a,b) => a.localeCompare(b)).join("-");
    const dmRoomId = `DM-${roomId}`;
    onJoinRoom(dmRoomId);
  };

  return (
    <div className="flex flex-col min-h-screen p-4 bg-sky-100 pixel-grid items-center relative">
      <div className="w-full max-w-md flex flex-col gap-4">
        
        {/* TOP BAR */}
        <div className="w-full bg-white p-3 flex justify-between items-center pixel-border shadow-[4px_4px_0_0_#db2777] mt-4">
          <div className="flex items-center gap-3">
            <div className="relative group">
              <img 
                src={currentUser.avatarUrl} 
                alt={currentUser.name} 
                className="w-10 h-10 pixel-border-sm bg-sky-50 cursor-pointer hover:bg-pink-100 transition-colors"
                onClick={onEditProfile}
              />
              <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-green-500 border-2 border-white rounded-full" title="Online" />
            </div>
            <div className="flex flex-col">
              <div className="font-pixel text-pink-600 text-lg tracking-widest leading-none">RGRAM97</div>
              <div className="font-pixel text-[7px] text-gray-400 mt-1 uppercase tracking-tighter">RETRO SOCIAL SPACE</div>
            </div>
          </div>
          <div className="flex gap-2">
            <button 
              onClick={() => setShowInfo(true)} 
              className="p-2 font-pixel text-[10px] bg-sky-100 pixel-border-sm hover:bg-sky-200 text-sky-600 uppercase flex items-center gap-1.5"
            >
              <span className="text-xs">📜</span> ABOUT
            </button>
            <button 
              onClick={onEditProfile} 
              className="p-2 bg-pink-100 pixel-border-sm hover:bg-pink-200 text-pink-600"
              title="Edit Profile"
            >
              <UserIcon size={16} />
            </button>
          </div>
        </div>

        {/* VIEW SELECTOR TABS */}
        <div className="flex gap-2 w-full mt-2">
          <button 
            onClick={() => setCurrentView("rooms")}
            className={`flex-1 py-3 font-pixel text-xs pixel-border transition-all uppercase flex items-center justify-center gap-2 ${currentView === "rooms" ? "bg-sky-500 text-white shadow-[4px_4px_0_0_#0369a1]" : "bg-white text-sky-600 hover:bg-sky-50"}`}
          >
            <span className="text-sm">🏠</span> LOBBY
          </button>
          <button 
            onClick={() => setCurrentView("inbox")}
            className={`flex-1 py-3 font-pixel text-xs pixel-border transition-all uppercase flex items-center justify-center gap-2 ${currentView === "inbox" ? "bg-purple-500 text-white shadow-[4px_4px_0_0_#7e22ce]" : "bg-white text-purple-600 hover:bg-purple-50"}`}
          >
            <span className="text-sm">📥</span> INBOX
          </button>
        </div>

        {currentView === "rooms" ? (
          <>
            {/* Join Room Form */}
            <div className="bg-white p-6 pixel-border flex flex-col gap-4 shadow-[4px_4px_0_0_#0ea5e9]">
              <h2 className="font-pixel text-sky-600">JOIN OR CREATE ROOM</h2>
              <form onSubmit={handleJoin} className="flex gap-2">
                <input
                  type="text"
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value)}
                  className="flex-1 p-3 text-xl outline-none bg-sky-50 pixel-border-sm focus:bg-white transition-colors uppercase"
                  placeholder="ROOM CODE"
                  maxLength={10}
                />
                <button
                  type="submit"
                  disabled={!roomCode.trim()}
                  className="bg-pink-500 text-white font-pixel text-sm px-4 py-2 pixel-border-sm hover:bg-pink-400 disabled:opacity-50 disabled:hover:bg-pink-500 cursor-pointer disabled:cursor-not-allowed transition-all active:translate-y-1 active:shadow-none"
                >
                  GO!
                </button>
              </form>
              <p className="text-gray-400 text-sm">Enter any code to create a room or join an existing one.</p>
            </div>

            {/* My Rooms List */}
            <div className="bg-white p-6 pixel-border flex flex-col gap-4 shadow-[4px_4px_0_0_#eab308]">
              <h2 className="font-pixel text-yellow-500">YOUR ROOMS</h2>
              
              {myRooms.filter(r => !r.id.startsWith("DM-")).length === 0 ? (
                <div className="text-center p-6 border-4 border-dashed border-sky-200 text-sky-400">
                  <p className="font-pixel text-xs">NO ROOMS YET</p>
                </div>
              ) : (
                <div className="flex flex-col gap-3 max-h-64 overflow-y-auto pr-2">
                  {myRooms.filter(r => !r.id.startsWith("DM-")).map((room) => {
                    return (
                      <div key={room.id} className="flex items-center justify-between p-3 bg-sky-50 pixel-border-sm group">
                        <div className="flex flex-col">
                            <span className="font-pixel text-sm text-sky-700">ROOM:{room.id}</span>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => onJoinRoom(room.id)}
                            className="bg-white p-2 pixel-border-sm hover:bg-green-100 text-green-500 transition-colors"
                            title="Join Room"
                          >
                            <ArrowRight size={20} className="stroke-[3px]" />
                          </button>
                          <button
                            onClick={() => setRoomToDelete(room.id)}
                            className="bg-white p-2 pixel-border-sm hover:bg-red-100 text-red-500 transition-colors"
                            title="Remove Room"
                          >
                            <Trash2 size={20} className="stroke-[3px]" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-4">
            {/* Inbox Section */}
            <div className="bg-white p-6 pixel-border flex flex-col gap-4 shadow-[4px_4px_0_0_#9333ea]">
              <div className="flex justify-between items-center">
                <h2 className="font-pixel text-purple-600 uppercase tracking-widest">Pixel Inbox</h2>
              </div>
              
              <div className="bg-purple-50 p-3 pixel-border-sm mb-2">
                <p className="font-pixel text-[8px] text-purple-600 uppercase mb-2">DIRECT CONVERSATIONS</p>
                {myRooms.filter(r => r.id.startsWith("DM-")).length === 0 ? (
                    <p className="font-pixel text-[8px] text-gray-400 italic">No active direct chats. Start one below!</p>
                ) : (
                    <div className="flex flex-col gap-2">
                        {myRooms.filter(r => r.id.startsWith("DM-")).map(room => (
                            <div key={room.id} className="flex items-center justify-between p-2 bg-white pixel-border-sm">
                                <span className="font-pixel text-[10px] text-zinc-700 truncate mr-2">DM_SYNC_{room.id.split('-').slice(1).join('_')}</span>
                                <div className="flex gap-1">
                                    <button
                                        onClick={() => onJoinRoom(room.id)}
                                        className="bg-green-100 p-1.5 pixel-border-sm text-green-600 hover:bg-green-200 transition-all"
                                    >
                                        <ArrowRight size={14} />
                                    </button>
                                    <button
                                        onClick={() => onDeleteRoom(room.id)}
                                        className="bg-red-100 p-1.5 pixel-border-sm text-red-600 hover:bg-red-200 transition-all"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
              </div>

              <div className="flex justify-between items-center mt-2">
                <h2 className="font-pixel text-purple-600 text-xs">YOUR FRIENDS ({friends.length})</h2>
              </div>
              
              {friends.length === 0 ? (
                <div className="text-center p-6 border-4 border-dashed border-purple-200 text-purple-400">
                  <p className="font-pixel text-[10px]">ADD FRIENDS FROM YOUR PROFILE NETWORK OPTION</p>
                </div>
              ) : (
                <div className="flex flex-col gap-3 max-h-80 overflow-y-auto pr-2">
                  {friends.map((friend) => (
                    <div key={friend.id} className="flex items-center justify-between p-2.5 bg-purple-50 pixel-border-sm group hover:bg-white transition-colors">
                      <div 
                        className="flex items-center gap-3 cursor-pointer"
                        onClick={() => setSelectedFriend(friend)}
                      >
                        <div className="relative">
                          <img src={friend.avatarUrl} className="w-10 h-10 pixel-border-sm bg-white" />
                          {onlineUsers.find(u => u.id === friend.id) && (
                            <div className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 border-2 border-white rounded-full" />
                          )}
                        </div>
                        <div className="flex flex-col">
                          <span className="font-pixel text-xs text-purple-700">{friend.name}</span>
                          <span className="font-pixel text-[8px] text-gray-400">VIEW BIO</span>
                        </div>
                      </div>
                      <button
                        onClick={() => handleStartChat(friend)}
                        className="p-2 pixel-border-sm bg-purple-500 text-white hover:bg-purple-400 transition-all"
                        title="Start Chat"
                      >
                        <span className="font-pixel text-[10px]">CHAT</span>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* === FRIEND PROFILE MODAL === */}
      {selectedFriend && (
        <div className="fixed inset-0 bg-sky-950/85 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white border-4 border-black p-6 w-full max-w-xs flex flex-col gap-4 shadow-[8px_8px_0_0_#9333ea]">
            <div className="flex justify-center -mt-12 bg-white p-1 pixel-border">
              <img src={selectedFriend.avatarUrl} className="w-24 h-24 bg-sky-50" />
            </div>
            
            <div className="text-center">
              <h3 className="font-pixel text-purple-600 text-lg uppercase">{selectedFriend.name}</h3>
              <p className="font-pixel text-[8px] text-gray-400 mt-0.5 tracking-widest">FRIEND STATUS: ACTIVE</p>
            </div>

            <div className="bg-purple-50 p-3 pixel-border-sm min-h-[60px]">
              <p className="font-pixel text-[10px] text-zinc-600 italic">
                {selectedFriend.bio || "No bio description provided."}
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <button
                onClick={() => {
                   handleStartChat(selectedFriend);
                   setSelectedFriend(null);
                }}
                className="w-full bg-purple-600 text-white font-pixel text-xs p-3 pixel-border hover:bg-purple-500 transition-all active:translate-y-1"
              >
                START DIRECT CHAT
              </button>
              <button
                onClick={() => setSelectedFriend(null)}
                className="w-full bg-white text-gray-500 font-pixel text-[10px] p-2 pixel-border-hover:bg-gray-100"
              >
                CLOSE
              </button>
            </div>
          </div>
        </div>
      )}

      {/* === INFO MODAL === */}
      {showInfo && (
        <div className="fixed inset-0 bg-sky-950/90 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-white border-4 border-black p-6 w-full max-w-sm flex flex-col gap-4 shadow-[8px_8px_0_0_#db2777] my-auto">
            <div className="flex justify-between items-center border-b-4 border-pink-100 pb-2">
              <h3 className="font-pixel text-pink-500 text-sm tracking-wide">RGRAM97 • SYSTEM_DOCS</h3>
              <button onClick={() => setShowInfo(false)} className="font-pixel text-xs text-gray-400 hover:text-red-500">[X]</button>
            </div>
            
            <div className="flex flex-col gap-3 overflow-y-auto max-h-[60vh] pr-1 custom-scrollbar">
              <section className="flex flex-col gap-1.5">
                <p className="font-pixel text-[9px] text-pink-600 uppercase font-bold">App Documentation</p>
                <p className="font-pixel text-[8px] text-zinc-600 leading-relaxed text-justify">
                  RGRAM97 IS A PREMIER RETRO-PIXEL COMMUNICATION HUB. FEATURES INCLUDE REAL-TIME ROOM CHATS, PIXEL ART STICKERS, VOICE MESSAGING, AND A SELF-DESTRUCTING "ONCEVIEW" MEDIA ENGINE. 
                  <br/><br/>
                  USERS CAN CREATE UNIQUE PROFILES WITH PIXEL AVATARS, ESTABLISH CONNECTIONS, AND TRACK GLOBAL ONLINE ACTIVITY. ALL COMMUNICATION IS VOLATILE AND DESIGNED FOR LIGHTNING-FAST PIXEL PERFORMANCE.
                </p>
              </section>

              <section className="flex flex-col gap-2 bg-sky-50 p-2.5 pixel-border-sm">
                <p className="font-pixel text-[9px] text-sky-600 uppercase">Support & Feedback</p>
                <div className="flex flex-col gap-1">
                  <p className="font-pixel text-[8px] text-sky-800 leading-tight">
                    ENCOUNTERED A BUG? NEED FEATURE REQUESTS? TAP THE SUPPORT CHANNEL BELOW.
                  </p>
                  <button 
                    onClick={() => window.open("https://www.linkedin.com/in/rehan-ahmad-863386382", "_blank")}
                    className="mt-1 bg-white p-1.5 font-pixel text-[8px] text-sky-700 pixel-border-sm hover:bg-sky-100 transition-all text-center"
                  >
                    🚀 CONTACT LIVE SUPPORT
                  </button>
                </div>
              </section>

              <section className="flex flex-col gap-2 border-t border-zinc-100 pt-2">
                <p className="font-pixel text-[9px] text-zinc-400 uppercase">Engineering Details</p>
                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between items-center">
                    <span className="font-pixel text-[8px] text-zinc-500">DEVELOPER:</span>
                    <span className="font-pixel text-[8px] text-zinc-800">REHAN97</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="font-pixel text-[8px] text-zinc-500">GITHUB:</span>
                    <a href="https://github.com/ft976" target="_blank" className="font-pixel text-[8px] text-blue-500 underline">@FT976</a>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="font-pixel text-[8px] text-zinc-500">BUILD_VER:</span>
                    <span className="font-pixel text-[8px] text-green-600">PRO_1.0.42</span>
                  </div>
                </div>
              </section>
            </div>
            
            <button
              onClick={() => setShowInfo(false)}
              className="mt-2 bg-pink-500 text-white font-pixel text-xs p-3 pixel-border hover:bg-pink-400 transition-all active:translate-y-1"
            >
              ACKNOWLEDGE & CLOSE
            </button>
          </div>
        </div>
      )}

      {/* === PIXEL ART DELETE CONFIRMATION MODAL === */}
      {roomToDelete && (
        <div className="fixed inset-0 bg-sky-950/85 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white border-4 border-black p-6 w-full max-w-xs text-center flex flex-col gap-4 shadow-[6px_6px_0_0_#db2777]">
            <h3 className="font-pixel text-red-500 text-sm tracking-wide">⚠️ WARNING!</h3>
            
            <p className="font-pixel text-xs text-black leading-relaxed">
              REMOVE ROOM:{roomToDelete} FROM YOUR SAVED LIST?
            </p>
            
            <p className="text-gray-400 text-[9px] leading-tight">
              This will remove the room shortcut. You can rejoin it later using its Room Code.
            </p>

            <div className="flex gap-3 justify-center mt-2">
              <button
                onClick={() => setRoomToDelete(null)}
                className="bg-sky-200 hover:bg-sky-300 text-sky-800 font-pixel text-[10px] p-2 px-3 pixel-border-sm cursor-pointer transition-all active:translate-y-0.5"
              >
                CANCEL
              </button>
              <button
                onClick={() => {
                  onDeleteRoom(roomToDelete);
                  setRoomToDelete(null);
                }}
                className="bg-red-600 hover:bg-red-500 text-white font-pixel text-[10px] p-2 px-4 pixel-border-sm cursor-pointer transition-all active:translate-y-0.5"
              >
                DELETE
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
