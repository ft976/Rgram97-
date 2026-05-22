import React, { useState, useRef, useEffect } from "react";
import { Play, Pause, Volume2 } from "lucide-react";

export function VoicePlayer({ audioUrl }: { audioUrl: string }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const audio = new Audio(audioUrl);
    audioRef.current = audio;

    const handleLoadedMetadata = () => {
      setDuration(audio.duration || 0);
    };

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("ended", handleEnded);

    return () => {
      audio.pause();
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("ended", handleEnded);
    };
  }, [audioUrl]);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().catch((err) => console.warn(err));
      setIsPlaying(true);
    }
  };

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!audioRef.current) return;
    const value = parseFloat(e.target.value);
    audioRef.current.currentTime = value;
    setCurrentTime(value);
  };

  const formatTime = (secs: number) => {
    if (isNaN(secs)) return "0:00";
    const minutes = Math.floor(secs / 60);
    const seconds = Math.floor(secs % 60);
    return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
  };

  return (
    <div className="w-[200px] sm:w-[240px] bg-sky-900 text-white p-3 pixel-border-sm flex flex-col gap-2 shadow-inner select-none">
      {/* Cassette Shell Design */}
      <div className="relative h-14 bg-sky-950 pixel-border-sm flex items-center justify-between px-6 overflow-hidden">
        {/* Left Reel Hole */}
        <div className="relative w-8 h-8 rounded-full border-2 border-dashed border-sky-600 flex items-center justify-center bg-black">
          <div
            className={`w-6 h-6 border-4 border-dashed border-pink-400 rounded-full ${
              isPlaying ? "animate-spin" : ""
            }`}
            style={{ animationDuration: "2.5s" }}
          />
        </div>

        {/* Tape Windows Label */}
        <div className="absolute top-1 left-12 right-12 h-2 bg-yellow-400 pixel-border-sm" />

        {/* Right Reel Hole */}
        <div className="relative w-8 h-8 rounded-full border-2 border-dashed border-sky-600 flex items-center justify-center bg-black">
          <div
            className={`w-6 h-6 border-4 border-dashed border-pink-400 rounded-full ${
              isPlaying ? "animate-spin" : ""
            }`}
            style={{ animationDuration: "2.5s" }}
          />
        </div>
      </div>

      {/* Control Panel */}
      <div className="flex items-center gap-2">
        <button
          onClick={togglePlay}
          className="bg-pink-500 text-white p-2 pixel-border-sm hover:bg-pink-400 active:translate-y-0.5 transition-all text-xs flex items-center justify-center"
        >
          {isPlaying ? <Pause size={12} className="fill-white" /> : <Play size={12} className="fill-white ml-0.5" />}
        </button>

        <div className="flex-1 flex flex-col gap-0.5">
          <input
            type="range"
            min="0"
            max={duration || 100}
            step="0.05"
            value={currentTime}
            onChange={handleSliderChange}
            className="w-full h-2 cursor-pointer appearance-none bg-sky-950 pixel-border-sm accent-pink-500 rounded"
          />
          <div className="flex justify-between text-[8px] font-pixel text-yellow-300">
            <span>{formatTime(currentTime)}</span>
            <span className="flex items-center gap-0.5">
              <Volume2 size={8} />
              {formatTime(duration)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
