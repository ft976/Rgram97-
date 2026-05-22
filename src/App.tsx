import { useState, useEffect } from "react";
import { User, RoomInfo } from "@/src/types";
import { Profile } from "./components/Profile";
import { Home } from "./components/Home";
import { Room } from "./components/Room";

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [myRooms, setMyRooms] = useState<RoomInfo[]>([]);
  
  const [currentScreen, setCurrentScreen] = useState<"loading" | "profile" | "home" | "room">("loading");
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);

  useEffect(() => {
    const storedUser = localStorage.getItem("pixel_user");
    const storedActiveRoom = localStorage.getItem("pixel_active_room_id");
    
    const storedRooms = localStorage.getItem("pixel_rooms");
    if (storedRooms) {
      setMyRooms(JSON.parse(storedRooms));
    }

    if (storedUser) {
      setCurrentUser(JSON.parse(storedUser));
      if (storedActiveRoom) {
        setActiveRoomId(storedActiveRoom);
        setCurrentScreen("room");
      } else {
        setCurrentScreen("home");
      }
    } else {
      setCurrentScreen("profile");
    }
  }, []);

  const saveUser = (user: User) => {
    localStorage.setItem("pixel_user", JSON.stringify(user));
    setCurrentUser(user);
    if (currentScreen === "profile") {
      const storedActiveRoom = localStorage.getItem("pixel_active_room_id");
      if (storedActiveRoom) {
        setActiveRoomId(storedActiveRoom);
        setCurrentScreen("room");
      } else {
        setCurrentScreen("home");
      }
    }
  };

  const handleJoinRoom = (roomId: string) => {
    // Add to myRooms if not exists
    const newRooms = [...myRooms];
    if (!newRooms.find(r => r.id === roomId)) {
      newRooms.push({ id: roomId, name: roomId });
      setMyRooms(newRooms);
      localStorage.setItem("pixel_rooms", JSON.stringify(newRooms));
    }
    setActiveRoomId(roomId);
    localStorage.setItem("pixel_active_room_id", roomId);
    setCurrentScreen("room");
  };

  const handleLeaveRoom = () => {
    localStorage.removeItem("pixel_active_room_id");
    setActiveRoomId(null);
    setCurrentScreen("home");
  };

  const handleDeleteRoom = (roomId: string) => {
    const newRooms = myRooms.filter(r => r.id !== roomId);
    setMyRooms(newRooms);
    localStorage.setItem("pixel_rooms", JSON.stringify(newRooms));
  };

  const handleSyncRooms = (serverRooms: RoomInfo[]) => {
      const merged = [...myRooms];
      let changed = false;
      serverRooms.forEach(sRoom => {
          if (!merged.find(m => m.id === sRoom.id)) {
              merged.push(sRoom);
              changed = true;
          }
      });
      if (changed) {
          setMyRooms(merged);
          localStorage.setItem("pixel_rooms", JSON.stringify(merged));
      }
  };

  if (currentScreen === "loading") {
    return <div className="min-h-screen bg-sky-200" />;
  }

  if (currentScreen === "profile" || !currentUser) {
    return <Profile initialUser={currentUser} onSave={saveUser} />;
  }

  if (currentScreen === "home") {
    return (
      <Home
        currentUser={currentUser}
        myRooms={myRooms}
        onJoinRoom={handleJoinRoom}
        onDeleteRoom={handleDeleteRoom}
        onSyncRooms={handleSyncRooms}
        onEditProfile={() => setCurrentScreen("profile")}
      />
    );
  }

  if (currentScreen === "room" && activeRoomId) {
    return (
      <div className="bg-sky-200 min-h-screen pixel-grid">
        <Room
          roomId={activeRoomId}
          currentUser={currentUser}
          onLeave={handleLeaveRoom}
        />
      </div>
    );
  }

  return null;
}

