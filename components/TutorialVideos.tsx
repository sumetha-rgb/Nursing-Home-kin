"use client";
import { useState } from "react";
import Icon from "./Icon";
import { TUTORIALS, youtubeId } from "@/lib/tutorials";

/** รายการวิดีโอสอนใช้งาน กดแล้วเล่นในหน้าเดียวกัน · only = เลขคลิปที่จะแสดงตามลำดับ (ไม่ระบุ = ทุกคลิป) */
export default function TutorialVideos({ only, compact = false }: { only?: number[]; compact?: boolean }) {
  const list = only ? only.flatMap((n) => TUTORIALS.filter((t) => t.no === n)) : TUTORIALS;
  const [playing, setPlaying] = useState<number | null>(null);
  return (
    <ul className={`tutorials ${compact ? "is-compact" : ""}`}>
      {list.map((t) => {
        const id = youtubeId(t.youtube);
        return (
          <li key={t.no}>
            {id && playing === t.no ? (
              <div className="tutorial-player">
                <iframe src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`} title={`คลิปสอนใช้งาน ${t.no} ${t.title}`}
                  allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen />
              </div>
            ) : (
              <button type="button" className="tutorial-thumb" disabled={!id} onClick={() => setPlaying(t.no)} aria-label={id ? `เล่นคลิป ${t.title}` : undefined}>
                {id && <img src={`https://i.ytimg.com/vi/${id}/hqdefault.jpg`} alt="" loading="lazy" />}
                <span className="tutorial-play">{id ? <Icon name="play" className="h-6 w-6" /> : "กำลังจัดทำวิดีโอ"}</span>
              </button>
            )}
            <div className="tutorial-info">
              <small>คลิป {t.no} · {t.who}</small>
              <b>{t.title}</b>
              {!compact && <span>{t.topics.join(" · ")}</span>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
