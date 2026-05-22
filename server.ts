import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { createServer } from "http";
import { Server } from "socket.io";
import fs from "fs";

const DB_FILE = path.join(process.cwd(), "sessions_db.json");

let sessions: Record<string, {
  users: Array<{ id: string; name: string; avatarUrl: string }>;
  messages: Array<{ 
    id: string; 
    userId: string; 
    userName: string; 
    userAvatarUrl: string; 
    text: string; 
    imageUrl?: string; 
    audioUrl?: string; 
    videoUrl?: string;
    timestamp: number;
    isDeleted?: boolean;
    hiddenFor?: string[];
  }>;
}> = {};

let registeredUsernames: Record<string, string> = {}; // lowercase name -> userId
let usersMetadata: Record<string, { id: string; name: string; avatarUrl: string; bio?: string }> = {};

let activeCalls: Record<string, {
  messageId: string;
  callerName: string;
  type: "audio" | "video";
  status: "dialing" | "ongoing" | "finished";
  startTime?: number;
}> = {};

// Track online users globally
let onlineUsers: Record<string, { id: string; name: string; avatarUrl: string }> = {};

// Track friendships: userId -> array of friend userIds
let friendships: Record<string, string[]> = {};
// Track pending friend requests: receiverId -> array of senderIds
let friendRequests: Record<string, string[]> = {};

// Load sessions from disk on startup
try {
  if (fs.existsSync(DB_FILE)) {
    const data = fs.readFileSync(DB_FILE, "utf-8");
    const parsed = JSON.parse(data);
    if (parsed.sessions) {
      sessions = parsed.sessions;
      registeredUsernames = parsed.registeredUsernames || {};
      usersMetadata = parsed.usersMetadata || {};
      friendships = parsed.friendships || {};
      friendRequests = parsed.friendRequests || {};
    } else {
      sessions = parsed;
      registeredUsernames = {};
      usersMetadata = {};
      friendships = {};
      friendRequests = {};
    }
    // On startup, we reset active users inside rooms as they will reconnect when they reload
    for (const roomId in sessions) {
      sessions[roomId].users = [];
    }
  }
} catch (e) {
  console.error("Error reading db file on startup:", e);
}

function saveSessions() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify({ sessions, registeredUsernames, usersMetadata, friendships, friendRequests }, null, 2), "utf-8");
  } catch (e) {
    console.error("Error writing db file:", e);
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;
  const httpServer = createServer(app);
  
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  io.on("connection", (socket) => {
    socket.on("join_room", ({ roomId, user }) => {
      socket.join(roomId);
      
      if (!sessions[roomId]) {
        sessions[roomId] = { users: [], messages: [] };
        saveSessions();
      }
      
      const existingUser = sessions[roomId].users.find((u) => u.id === user.id);
      if (!existingUser) {
        sessions[roomId].users.push(user);
      } else {
        // Update user details
        sessions[roomId].users = sessions[roomId].users.map(u => u.id === user.id ? user : u);
      }

      // Send current state
      socket.emit("room_state", {
        users: sessions[roomId].users,
        messages: sessions[roomId].messages,
      });

      // Broadcast user joined
      socket.to(roomId).emit("user_joined", user);
      
      // Store user info in socket for disconnect handling
      socket.data.user = user;
      socket.data.roomId = roomId;
    });

    socket.on("send_message", ({ roomId, message }) => {
      if (sessions[roomId]) {
        sessions[roomId].messages.push(message);
        saveSessions();
        io.to(roomId).emit("new_message", message);
      }
    });

    socket.on("initiate_call", ({ roomId, caller, type }) => {
      socket.to(roomId).emit("incoming_call", { roomId, caller, type });
      
      if (sessions[roomId]) {
        const displayType = type === "video" ? "📹 VIDEO" : "📞 VOICE";
        const msgId = "call_" + Date.now() + "_" + Math.random().toString(36).substring(2, 6);
        const msg = {
          id: msgId,
          userId: "system_call",
          userName: "Call System",
          userAvatarUrl: "",
          text: `DIALING: ${caller.name} started a ${displayType} call...`,
          timestamp: Date.now()
        };
        sessions[roomId].messages.push(msg);
        
        activeCalls[roomId] = {
          messageId: msgId,
          callerName: caller.name,
          type,
          status: "dialing"
        };

        saveSessions();
        io.to(roomId).emit("new_message", msg);
      }
    });

    socket.on("answer_call", ({ roomId, callee }) => {
      socket.to(roomId).emit("call_answered", { roomId, callee });

      if (sessions[roomId]) {
        const active = activeCalls[roomId];
        const now = Date.now();
        if (active) {
          active.status = "ongoing";
          active.startTime = now;
          const displayType = active.type === "video" ? "📹 VIDEO" : "📞 VOICE";
          
          sessions[roomId].messages = sessions[roomId].messages.map((m) => {
            if (m.id === active.messageId) {
              return { ...m, text: `🟢 ACTIVE ${displayType} CALL (${active.callerName} & ${callee.name})` };
            }
            return m;
          });
          
          saveSessions();
          const updatedMsg = sessions[roomId].messages.find(m => m.id === active.messageId);
          if (updatedMsg) {
            io.to(roomId).emit("message_updated", updatedMsg);
          }
        }
      }
    });

    socket.on("decline_call", ({ roomId, callee }) => {
      socket.to(roomId).emit("call_declined", { roomId, callee });

      if (sessions[roomId]) {
        const active = activeCalls[roomId];
        if (active) {
          const displayType = active.type === "video" ? "📹 VIDEO" : "📞 VOICE";
          sessions[roomId].messages = sessions[roomId].messages.map((m) => {
            if (m.id === active.messageId) {
              return { ...m, text: `❌ MISSED/DECLINED ${displayType} CALL (Caller: ${active.callerName})` };
            }
            return m;
          });
          delete activeCalls[roomId];
          saveSessions();

          const updatedMsg = sessions[roomId].messages.find(m => m.id === active.messageId);
          if (updatedMsg) {
            io.to(roomId).emit("message_updated", updatedMsg);
          }
        }
      }
    });

    socket.on("end_call", ({ roomId, user }) => {
      socket.to(roomId).emit("call_ended", { roomId, user });

      if (sessions[roomId]) {
        const active = activeCalls[roomId];
        if (active) {
          const displayType = active.type === "video" ? "📹 VIDEO" : "📞 VOICE";
          let durationStr = "Call completed";
          if (active.startTime) {
            const elapsed = Math.floor((Date.now() - active.startTime) / 1000);
            const mins = Math.floor(elapsed / 60);
            const secs = elapsed % 60;
            durationStr = `${mins}m ${secs}s`;
          } else {
            durationStr = "No answer";
          }

          sessions[roomId].messages = sessions[roomId].messages.map((m) => {
            if (m.id === active.messageId) {
              return { ...m, text: `🏁 FINISHED ${displayType} CALL • Duration: ${durationStr}` };
            }
            return m;
          });
          delete activeCalls[roomId];
          saveSessions();

          const updatedMsg = sessions[roomId].messages.find(m => m.id === active.messageId);
          if (updatedMsg) {
            io.to(roomId).emit("message_updated", updatedMsg);
          }
        }
      }
    });

    socket.on("webrtc_signal", ({ roomId, signal, senderId }) => {
      socket.to(roomId).emit("webrtc_signal", { signal, senderId });
    });

    socket.on("delete_message", ({ roomId, messageId }) => {
      if (sessions[roomId]) {
        const foundMsg = sessions[roomId].messages.find(m => m.id === messageId);
        if (foundMsg && (foundMsg.userId === "system_call" || foundMsg.userId === "system_alert")) {
          return; // Strictly block deleting system-generated security and call alerts
        }
        sessions[roomId].messages = sessions[roomId].messages.map(m => 
          m.id === messageId ? { ...m, isDeleted: true, text: "MESSAGE_UNSENT", imageUrl: undefined, videoUrl: undefined, audioUrl: undefined } : m
        );
        saveSessions();
        io.to(roomId).emit("message_deleted", messageId);
      }
    });

    socket.on("delete_message_for_me", ({ roomId, messageId, userId }) => {
      if (sessions[roomId]) {
        sessions[roomId].messages = sessions[roomId].messages.map(m => {
          if (m.id === messageId) {
            const hiddenFor = m.hiddenFor || [];
            if (!hiddenFor.includes(userId)) {
              return { ...m, hiddenFor: [...hiddenFor, userId] };
            }
          }
          return m;
        });
        saveSessions();
        socket.emit("message_hidden_for_me", messageId);
      }
    });

    socket.on("view_message", ({ roomId, messageId }) => {
      if (sessions[roomId]) {
        sessions[roomId].messages = sessions[roomId].messages.map(m => 
          m.id === messageId ? { ...m, isOpened: true } : m
        );
        saveSessions();
        const updatedMsg = sessions[roomId].messages.find(m => m.id === messageId);
        if (updatedMsg) {
          io.to(roomId).emit("message_updated", updatedMsg);
        }
      }
    });

    socket.on("join_lobby", ({ user }) => {
      onlineUsers[user.id] = user;
      usersMetadata[user.id] = user;
      socket.data.user = user;
      saveSessions();
      
      const myFriends = friendships[user.id] || [];
      const friendsData = myFriends.map(fId => usersMetadata[fId]).filter(Boolean);
      
      socket.emit("lobby_init", {
        onlineUsers: Object.values(onlineUsers),
        friends: friendsData,
        pendingRequests: (friendRequests[user.id] || []).map(senderId => ({
            senderId,
            senderUser: usersMetadata[senderId]
        })).filter(r => r.senderUser)
      });
      
      io.emit("update_online_users", Object.values(onlineUsers));
    });

    socket.on("get_user_profile", (targetId) => {
        const profile = usersMetadata[targetId];
        if (profile) {
            socket.emit("user_profile_data", profile);
        }
    });

    socket.on("send_friend_request", ({ senderId, receiverId, senderUser }) => {
      usersMetadata[senderId] = senderUser;
      if (!friendRequests[receiverId]) friendRequests[receiverId] = [];
      if (!friendRequests[receiverId].includes(senderId)) {
        friendRequests[receiverId].push(senderId);
        saveSessions();
        // Notify receiver
        for (const [sId, s] of Object.entries(io.sockets.sockets)) {
          if (s.data.user?.id === receiverId) {
            s.emit("new_friend_request", { senderId, senderUser });
          }
        }
      }
    });

    socket.on("accept_friend_request", ({ accepterId, requesterId }) => {
      if (!friendships[accepterId]) friendships[accepterId] = [];
      if (!friendships[requesterId]) friendships[requesterId] = [];
      
      if (!friendships[accepterId].includes(requesterId)) friendships[accepterId].push(requesterId);
      if (!friendships[requesterId].includes(accepterId)) friendships[requesterId].push(accepterId);
      
      // Remove from requests
      if (friendRequests[accepterId]) {
        friendRequests[accepterId] = friendRequests[accepterId].filter(id => id !== requesterId);
      }
      
      saveSessions();
      
      // Notify both
      for (const [sId, s] of Object.entries(io.sockets.sockets)) {
        const socketUser = s.data.user;
        if (socketUser?.id === accepterId) {
            s.emit("friend_accepted", usersMetadata[requesterId]);
        } else if (socketUser?.id === requesterId) {
            s.emit("friend_accepted", usersMetadata[accepterId]);
        }
      }
    });

    socket.on("reject_friend_request", ({ rejecterId, requesterId }) => {
      if (friendRequests[rejecterId]) {
        friendRequests[rejecterId] = friendRequests[rejecterId].filter(id => id !== requesterId);
        saveSessions();
        // Notify rejecter (the requester doesn't necessarily need to know they were rejected for privacy, but we clear it for the rejecter)
        socket.emit("friend_request_rejected", requesterId);
      }
    });

    socket.on("user_typing", ({ roomId, userId, userName, isTyping }) => {
      socket.to(roomId).emit("user_typing_update", { roomId, userId, userName, isTyping });
    });

    socket.on("disconnect", () => {
      if (socket.data.user) {
        delete onlineUsers[socket.data.user.id];
        io.emit("update_online_users", Object.values(onlineUsers));
      }
    });
  });

  // Enable JSON body parsing first
  app.use(express.json());

  // API endpoints to enforce unique username registration
  app.get("/api/check-username", (req, res) => {
    const name = (req.query.name as string || "").trim().toLowerCase();
    const userId = (req.query.userId as string || "").trim();
    
    if (!name) {
      return res.json({ available: false, reason: "Username name is required." });
    }
    
    const ownerId = registeredUsernames[name];
    if (ownerId && ownerId !== userId) {
      return res.json({ available: false, reason: "Username already taken! Please choose another." });
    }
    
    return res.json({ available: true });
  });

  app.post("/api/claim-username", (req, res) => {
    const { name, userId, avatarUrl, bio } = req.body;
    const trimmedName = (name || "").trim();
    const normalized = trimmedName.toLowerCase();
    
    if (!trimmedName || !userId) {
      return res.json({ success: false, reason: "Missing username or userId." });
    }
    
    const ownerId = registeredUsernames[normalized];
    if (ownerId && ownerId !== userId) {
      return res.json({ success: false, reason: "Username already taken! Please choose another." });
    }
    
    // Reserve it
    registeredUsernames[normalized] = userId;
    usersMetadata[userId] = { 
        id: userId, 
        name: trimmedName, 
        avatarUrl: avatarUrl || "", 
        bio: bio || "" 
    };
    saveSessions();
    
    return res.json({ success: true, name: trimmedName });
  });

  // API routes FIRST
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
