import React, { useState, useEffect } from "react";
import { PIXEL_AVATARS, getRandomAvatar } from "@/src/lib/avatars";
import { User } from "@/src/types";
import { io, Socket } from "socket.io-client";
import { UserPlus, Check } from "lucide-react";

export function Profile({
  initialUser,
  onSave,
}: {
  initialUser: User | null;
  onSave: (user: User) => void;
}) {
  const [activeTab, setActiveTab] = useState<"edit" | "friends" | "connections">("edit");
  const [userId] = useState(() => initialUser?.id || "u_" + Math.random().toString(36).substring(2, 9));
  const [name, setName] = useState(initialUser?.name || "");
  const [bio, setBio] = useState(initialUser?.bio || "");
  const [avatarUrl, setAvatarUrl] = useState(initialUser?.avatarUrl || getRandomAvatar());
  const [friends, setFriends] = useState<User[]>([]);
  const [errorMsg, setErrorMsg] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);

  // Connection states
  const [socket, setSocket] = useState<Socket | null>(null);
  const [onlineUsers, setOnlineUsers] = useState<User[]>([]);
  const [friendRequests, setFriendRequests] = useState<Array<{senderId: string, senderUser: User}>>([]);
  const [searchUser, setSearchUser] = useState("");
  const [searchResults, setSearchResults] = useState<User[]>([]);

  useEffect(() => {
    if (!initialUser) return;
    const newSocket = io("/");
    setSocket(newSocket);

    newSocket.on("connect", () => {
      newSocket.emit("join_lobby", { user: initialUser });
    });

    newSocket.on("lobby_init", (data: { onlineUsers: User[], friends: User[], pendingRequests: Array<{senderId: string, senderUser: User}> }) => {
      setOnlineUsers(data.onlineUsers.filter(u => u.id !== initialUser.id));
      setFriends(data.friends);
      setFriendRequests(data.pendingRequests);
    });

    newSocket.on("search_results", (results: User[]) => {
      setSearchResults(results.filter(u => u.id !== initialUser.id));
    });

    newSocket.on("update_online_users", (users) => {
      setOnlineUsers(users.filter((u: User) => u.id !== initialUser.id));
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
      setFriendRequests(prev => prev.filter(r => r.senderId !== newFriend.id));
    });

    newSocket.on("friend_request_rejected", (requesterId: string) => {
      setFriendRequests(prev => prev.filter(r => r.senderId !== requesterId));
    });

    return () => {
      newSocket.disconnect();
    };
  }, [initialUser]);

  useEffect(() => {
    if (socket && searchUser.trim()) {
        const timeout = setTimeout(() => {
            socket.emit("search_users", searchUser);
        }, 300);
        return () => clearTimeout(timeout);
    } else {
        setSearchResults([]);
    }
  }, [searchUser, socket]);

  const handleAddFriend = (targetUserId: string) => {
    if (!socket || !initialUser) return;
    socket.emit("send_friend_request", { senderId: initialUser.id, receiverId: targetUserId, senderUser: initialUser });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setIsSubmitting(true);

    try {
      const finalAvatar = avatarUrl.trim() || getRandomAvatar();

      // Backend calls removed for better deployment compatibility (e.g. Vercel)
      // Any username is now allowed without server-side uniqueness check
      
      onSave({
        id: userId,
        name: name.trim() || "Anonymous",
        bio: bio.trim(),
        avatarUrl: finalAvatar,
      });
    } catch (err) {
      console.error("Error saving profile:", err);
      setErrorMsg(`Save failure! (${err instanceof Error ? err.message : "Local Storage Error"}). Please try again.`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-sky-200">
      <div className="bg-white p-6 max-w-sm w-full pixel-border flex flex-col gap-4 shadow-[8px_8px_0_0_#db2777]">
        <div className="text-center mb-2">
          <h1 className="font-pixel text-2xl text-pink-500 pixel-text-shadow uppercase tracking-widest">RGRAM97</h1>
          
          <div className="flex gap-2 justify-center mt-4 border-b border-gray-200 pb-2">
            <button onClick={() => setActiveTab("edit")} className={`font-pixel text-[10px] px-2 py-1 ${activeTab === "edit" ? "bg-pink-100 text-pink-600" : "text-gray-400"}`}>PROFILE</button>
            <button onClick={() => setActiveTab("friends")} className={`font-pixel text-[10px] px-2 py-1 ${activeTab === "friends" ? "bg-pink-100 text-pink-600" : "text-gray-400"}`}>
              FRIENDS ({friends.length})
            </button>
            <button onClick={() => setActiveTab("connections")} className={`font-pixel text-[10px] px-2 py-1 relative ${activeTab === "connections" ? "bg-pink-100 text-pink-600" : "text-gray-400"}`}>
              CONNECT
              {friendRequests.length > 0 && (
                <span className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full animate-pulse shadow-sm" />
              )}
            </button>
          </div>
        </div>

        {activeTab === "edit" ? (
          <form onSubmit={handleSave} className="flex flex-col gap-4 mt-2">
            <div className="flex flex-col items-center gap-2 mb-4">
              <div className="relative group">
                <img
                  src={avatarUrl.trim() || getRandomAvatar()}
                  alt="Avatar Preview"
                  className="w-24 h-24 pixel-border bg-sky-50 shadow-[4px_4px_0_0_#0ea5e9]"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = getRandomAvatar();
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowAvatarPicker(!showAvatarPicker)}
                  className="absolute bottom-0 right-0 bg-pink-500 text-white p-1 pixel-border-sm hover:bg-pink-400 text-[8px] font-pixel"
                >
                  CHANGE
                </button>
              </div>

              {showAvatarPicker && (
                <div className="grid grid-cols-5 gap-1.5 p-2 bg-sky-50 pixel-border-sm max-h-40 overflow-y-auto mt-2">
                  {PIXEL_AVATARS.map((url, i) => (
                    <img
                      key={i}
                      src={url}
                      alt={`Avatar ${i}`}
                      className={`w-8 h-8 pixel-border-sm cursor-pointer hover:bg-white p-0.5 ${avatarUrl === url ? "bg-pink-200 outline-2 outline-pink-500" : "bg-white"}`}
                      onClick={() => {
                        setAvatarUrl(url);
                        setShowAvatarPicker(false);
                      }}
                    />
                  ))}
                </div>
              )}
            </div>

            {errorMsg && (
              <div className="bg-red-500 text-white font-pixel text-[9px] p-2 pixel-border-sm text-center animate-pulse leading-normal">
                ⚠️ {errorMsg.toUpperCase()}
              </div>
            )}

            <div className="flex flex-col gap-1">
              <label className="font-pixel text-[10px] text-sky-500">USERNAME (OPTIONAL)</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="p-3 text-xl outline-none bg-sky-50 pixel-border-sm focus:bg-white transition-colors animate-none"
                placeholder="e.g. PixelHero"
                maxLength={15}
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="font-pixel text-[10px] text-sky-500">BIO (OPTIONAL)</label>
              <input
                type="text"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                className="p-3 text-lg outline-none bg-sky-50 pixel-border-sm focus:bg-white transition-colors"
                placeholder="e.g. I love pixels!"
                maxLength={30}
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="mt-6 bg-pink-500 text-white font-pixel text-sm p-4 pixel-border hover:bg-pink-400 disabled:opacity-50 disabled:hover:bg-pink-500 cursor-pointer transition-all active:translate-y-1 active:shadow-none"
            >
              {isSubmitting ? "SAVING..." : "SAVE PROFILE"}
            </button>
          </form>
        ) : activeTab === "friends" ? (
          <div className="flex flex-col gap-4 mt-2">
             <div className="flex flex-col gap-2 max-h-80 overflow-y-auto pr-1">
                <h3 className="font-pixel text-purple-600 text-[9px] uppercase tracking-tighter">Your Network ({friends.length})</h3>
                {friends.length === 0 && <p className="font-pixel text-[8px] text-gray-400 text-center py-8">NO FRIENDS YET. GO TO CONNECT TAB!</p>}
                {friends.map((friend) => (
                  <div key={friend.id} className="flex items-center justify-between p-2.5 bg-purple-50 pixel-border-sm">
                    <div className="flex items-center gap-2">
                      <img src={friend.avatarUrl} className="w-8 h-8 pixel-border-sm bg-white" />
                      <div className="flex flex-col">
                        <span className="font-pixel text-[10px] text-purple-700">{friend.name}</span>
                        {onlineUsers.find(u => u.id === friend.id) && <span className="font-pixel text-[6px] text-green-500">● ONLINE</span>}
                      </div>
                    </div>
                  </div>
                ))}
             </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4 mt-2">
            <div className="bg-pink-50 p-3 pixel-border-sm">
              <p className="font-pixel text-[8px] text-pink-600 uppercase border-b border-pink-100 pb-1 mb-2">Search Network</p>
              <input
                type="text"
                value={searchUser}
                onChange={(e) => setSearchUser(e.target.value)}
                className="p-2 w-full font-pixel text-xs bg-white pixel-border-sm outline-none focus:bg-pink-50"
                placeholder="🔍 USERNAME..."
              />
            </div>
            
            <div className="flex flex-col gap-2 max-h-64 overflow-y-auto pr-1">
              <h3 className="font-pixel text-sky-600 text-[9px] uppercase tracking-tighter">Search Results</h3>
              {searchUser.trim() && searchResults.length === 0 && <p className="font-pixel text-[8px] text-gray-400">No matching users found.</p>}
              {!searchUser.trim() && onlineUsers.length > 0 && <p className="font-pixel text-[8px] text-sky-400 italic">Try searching for any username!</p>}
              {searchResults.map((user) => (
                <div key={user.id} className="flex items-center justify-between p-2 bg-sky-50 pixel-border-sm hover:bg-white transition-colors">
                  <div className="flex items-center gap-2">
                    <img src={user.avatarUrl} className="w-6 h-6 pixel-border-sm bg-white" />
                    <div className="flex flex-col">
                        <span className="font-pixel text-[10px] text-zinc-700">{user.name}</span>
                        {onlineUsers.find(o => o.id === user.id) && <span className="font-pixel text-[6px] text-green-500 uppercase">Online</span>}
                    </div>
                  </div>
                  {friends.find(f => f.id === user.id) ? (
                      <div className="bg-green-100 p-1 pixel-border-sm text-green-600">
                          <Check size={14} />
                      </div>
                  ) : (
                    <button
                        onClick={() => handleAddFriend(user.id)}
                        className="bg-white p-1 pixel-border-sm hover:bg-green-100 text-green-500 transition-all active:scale-95"
                        title="Send Friend Request"
                    >
                        <UserPlus size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {friendRequests.length > 0 && (
              <div className="pt-3 border-t-2 border-dashed border-pink-200 mt-2">
                <div className="flex items-center gap-2 mb-2">
                    <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                    <h3 className="font-pixel text-pink-600 text-[9px] uppercase">Pending Requests</h3>
                </div>
                <div className="flex flex-col gap-2">
                  {friendRequests.map((req) => (
                    <div key={req.senderId} className="flex items-center justify-between p-2 bg-pink-50 pixel-border-sm border-l-4 border-l-pink-500">
                      <div className="flex items-center gap-2">
                          <img src={req.senderUser.avatarUrl} className="w-7 h-7 pixel-border-sm bg-white" />
                          <div className="flex flex-col">
                            <span className="font-pixel text-[10px] text-pink-700">{req.senderUser.name}</span>
                            <span className="font-pixel text-[6px] text-gray-400">WANTS TO CONNECT</span>
                          </div>
                      </div>
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => {
                              if (socket) socket.emit("accept_friend_request", { accepterId: initialUser!.id, requesterId: req.senderId });
                          }}
                          className="bg-green-500 text-white p-1.5 pixel-border-sm hover:bg-green-400 shadow-[1px_1px_0_0_#000]"
                        >
                          <Check size={14} />
                        </button>
                        <button
                          onClick={() => {
                              if (socket) socket.emit("reject_friend_request", { rejecterId: initialUser!.id, requesterId: req.senderId });
                          }}
                          className="bg-red-500 text-white p-1.5 pixel-border-sm hover:bg-red-400 shadow-[1px_1px_0_0_#000]"
                        >
                          <span className="font-pixel text-xs">X</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
