"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const WORD = "ValueInsight";

/** 手绘字形：与 IV 标记同一套笔画，用于文字标里的 V 与 I */
const GLYPHS = {
  V: {
    className: "brand-letter-v",
    viewBox: "0 0 27 40",
    paths: [
      { d: "M2 6c2.5 10 4.5 20 8 28", w: 3.7 },
      { d: "M10 34c5-10 10-20 15-28", w: 3.7 },
    ],
  },
  I: {
    className: "brand-letter-i",
    viewBox: "0 0 20 40",
    paths: [{ d: "M2 6c1.6 9.5 5 20 15 28", w: 3.3 }],
  },
} as const;

/**
 * 品牌标记：默认平铺 ValueInsight 文字标；下滚超过 48px 后，
 * 每个字母依次翻牌（rotateX）转走，翻完露出 IV（Intrinsic Value）标记。
 * V 正立，I 是一笔向左弧出的竖画，收在 V 左侧并贴近落点。
 * 字母格子固定宽度，整段过程导航不发生位移。
 */
export default function BrandLogo({
  className = "navbar-brand",
  href = "/home",
  label = "ValueInsight 首页",
}: {
  className?: string;
  href?: string;
  label?: string;
}) {
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setCompact(window.scrollY > 48);
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <Link
      className={className}
      href={href}
      aria-label={compact ? "IV · Intrinsic Value" : label}
      data-compact={compact ? "true" : "false"}
    >
      <span className="brand-slot">
        <span className="brand-word" aria-hidden="true">
          {[...WORD].map((ch, i) => {
            const glyph = GLYPHS[ch as keyof typeof GLYPHS];
            const style = {
              "--in": `${i * 30}ms`,
              "--out": `${(WORD.length - 1 - i) * 22}ms`,
            } as React.CSSProperties;
            if (!glyph) {
              return (
                <span key={`${ch}-${i}`} className="brand-letter" style={style}>
                  {ch}
                </span>
              );
            }
            return (
              <span key={`${ch}-${i}`} className={`brand-letter ${glyph.className}`} style={style}>
                {/* 与 IV 标记同一笔：V 双臂、I 向左弧出 */}
                <svg
                  className="brand-glyph"
                  viewBox={glyph.viewBox}
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                >
                  {glyph.paths.map((p) => (
                    <path key={p.d} d={p.d} strokeWidth={p.w} />
                  ))}
                </svg>
              </span>
            );
          })}
        </span>
        <span className="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 48 40" fill="none" stroke="currentColor" strokeLinecap="round">
            {/* 向左弧出的 I：起笔偏左，收笔贴近 V 的落点 */}
            <path d="M8 6c1.6 9.5 5 20 15 28" strokeWidth="3.5" />
            {/* V：左臂略带弧，右臂正立起笔 */}
            <path d="M20 6c2.5 10 4.5 20 8 28" strokeWidth="3.8" />
            <path d="M28 34c5-10 10-20 15-28" strokeWidth="3.8" />
          </svg>
        </span>
      </span>
    </Link>
  );
}
