import Link from "next/link";
import React from "react";

type ButtonProps = {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
  href?: string;
  children: React.ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement> &
  React.AnchorHTMLAttributes<HTMLAnchorElement>;

const variantClasses: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary:
    "bg-textPrimary text-bgApp hover:bg-textMuted shadow-sm border border-transparent font-medium",
  secondary:
    "border border-borderSubtle bg-bgSurface text-textPrimary hover:bg-surface-muted",
  ghost: "bg-transparent text-textPrimary hover:bg-surface-muted",
  danger: "bg-danger text-textPrimary hover:opacity-90",
};

const sizeClasses: Record<NonNullable<ButtonProps["size"]>, string> = {
  xs: "px-2.5 py-1 text-xs",
  sm: "px-3 py-1.5 text-sm",
  md: "px-4 py-2 text-sm",
  lg: "px-5 py-3 text-base",
};

export const Button = ({
  variant = "primary",
  size = "md",
  className = "",
  href,
  children,
  ...rest
}: ButtonProps) => {
  const classes = [
    "inline-flex items-center justify-center gap-2 font-semibold rounded-md transition focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-60 disabled:cursor-not-allowed",
    variantClasses[variant],
    sizeClasses[size],
    className,
  ]
    .filter(Boolean)
    .join(" ");

  if (href) {
    const { onClick, ...linkProps } = rest;
    return (
      <Link
        href={href}
        className={classes}
        onClick={onClick as any}
        {...(linkProps as any)}
      >
        {children}
      </Link>
    );
  }

  return (
    <button type={rest.type || "button"} className={classes} {...rest}>
      {children}
    </button>
  );
};

export default Button;
