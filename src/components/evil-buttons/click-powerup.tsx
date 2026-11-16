"use client";

import * as React from "react";

export interface ClickPowerUpProps
  extends Omit<
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    "onDrag" | "onDragStart" | "onDragEnd" | "onAnimationStart"
  > {
  /** Milliseconds the powered-up flash lasts after a click. */
  tapDuration?: number;
  /** Color of the powered-up flash. */
  accentColor?: string;
}

type Phase = "rest" | "hover" | "tap" | "powered";
type Corner = "tl" | "tr" | "bl" | "br";

const CORNERS: Corner[] = ["tl", "tr", "bl", "br"];

export const ClickPowerUp = React.forwardRef<
  HTMLButtonElement,
  ClickPowerUpProps
>(
  (
    {
      children,
      className,
      tapDuration = 500,
      accentColor = "#2CD4BD",
      onClick,
      onPointerEnter,
      onPointerLeave,
      onPointerDown,
      onPointerUp,
      onPointerCancel,
      style,
      disabled,
      type = "button",
      ...props
    },
    ref,
  ) => {
    const [hovered, setHovered] = React.useState(false);
    const [pressed, setPressed] = React.useState(false);
    const [powered, setPowered] = React.useState(false);
    const [burstKey, setBurstKey] = React.useState(0);
    const poweredTimerRef = React.useRef<number | undefined>(undefined);

    React.useEffect(
      () => () => window.clearTimeout(poweredTimerRef.current),
      [],
    );

    const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
      onClick?.(event);
      if (disabled) return;
      setPowered(true);
      setBurstKey((key) => key + 1);
      window.clearTimeout(poweredTimerRef.current);
      poweredTimerRef.current = window.setTimeout(
        () => setPowered(false),
        tapDuration,
      );
    };

    const phase: Phase = pressed
      ? "tap"
      : powered
        ? "powered"
        : hovered
          ? "hover"
          : "rest";

    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled}
        onClick={handleClick}
        onPointerDown={(event) => {
          onPointerDown?.(event);
          if (event.button === 0 && !disabled) setPressed(true);
        }}
        onPointerUp={(event) => {
          onPointerUp?.(event);
          setPressed(false);
        }}
        onPointerCancel={(event) => {
          onPointerCancel?.(event);
          setPressed(false);
        }}
        onPointerEnter={(event) => {
          onPointerEnter?.(event);
          if (event.pointerType !== "touch" && !disabled) setHovered(true);
        }}
        onPointerLeave={(event) => {
          onPointerLeave?.(event);
          setHovered(false);
          setPressed(false);
        }}
        onBlur={() => {
          setHovered(false);
          setPressed(false);
        }}
        style={{ "--powerup": accentColor, ...style } as React.CSSProperties}
        className={["click-powerup", `is-${phase}`, className]
          .filter(Boolean)
          .join(" ")}
        {...props}
      >
        <span className="click-powerup-face" aria-hidden="true">
          <span className="click-powerup-hatch" />
          <span className="click-powerup-panel" />
          <span className="click-powerup-flash" />
        </span>

        {CORNERS.map((corner) => (
          <span
            key={corner}
            className={`click-powerup-corner corner-${corner}`}
            aria-hidden="true"
          />
        ))}

        {powered && (
          <span className="click-powerup-burst" aria-hidden="true" key={burstKey}>
            {CORNERS.map((corner) => (
              <span
                key={corner}
                className={`click-powerup-burst-corner burst-${corner}`}
              />
            ))}
          </span>
        )}

        <span className="click-powerup-label">{children}</span>
      </button>
    );
  },
);

ClickPowerUp.displayName = "ClickPowerUp";
