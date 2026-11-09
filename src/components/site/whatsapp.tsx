import { MessageCircle } from "lucide-react";
import { buttonClass } from "@/components/ui";

export function whatsappHref(number: string, text: string) {
  const digits = number.replace(/\D/g, "");
  return digits ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : null;
}

export function WhatsAppButton({ number, text, label = "Ask on WhatsApp", size = "md", fixture }: { number: string; text: string; label?: string; size?: "md" | "lg"; fixture?: boolean }) {
  const href = whatsappHref(number, text);
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={buttonClass("primary", size)} aria-label={`${label} (opens WhatsApp)`} title={fixture ? "Development fixture number" : undefined}>
      <MessageCircle className="size-5" aria-hidden /> {label}
    </a>
  );
}
