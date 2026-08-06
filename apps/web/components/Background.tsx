/**
 * Fixed decorative backdrop: a faint monochrome grid plus a single soft white spotlight behind
 * the header — no color, no motion. Rendered once in the root layout, behind everything else.
 * aria-hidden and never intercepts pointer events.
 */
export function Background() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-black">
      <div className="absolute inset-0 opacity-[0.06] [background-image:linear-gradient(to_right,#fff_1px,transparent_1px),linear-gradient(to_bottom,#fff_1px,transparent_1px)] [background-size:64px_64px] [mask-image:radial-gradient(ellipse_70%_60%_at_50%_0%,black_10%,transparent_70%)]" />
      <div className="absolute left-1/2 top-[-20%] h-[70vmax] w-[70vmax] -translate-x-1/2 rounded-full bg-white/[0.05] blur-[160px]" />
    </div>
  );
}
