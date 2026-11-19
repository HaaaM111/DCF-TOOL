import Link from "next/link";
import BrandLogo from "@/components/brand-logo";

const stack = ["Next.js", "React", "TypeScript", "Node.js", "Prisma", "SQLite"];

function Starfield() {
  return (
    <svg className="landing-starfield" viewBox="0 0 1440 460" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0 410C170 210 210 110 350 0M80 460C250 250 285 115 430 0M190 460C350 245 390 110 525 0M1280 460C1160 275 1120 150 1060 0M1380 460C1250 260 1215 135 1160 0M1440 390C1320 220 1300 120 1260 0" />
      <path d="M0 370C145 220 245 160 370 0M1440 335C1300 180 1240 100 1205 0" className="landing-starfield-fine" />
      <circle cx="346" cy="207" r="2" /><circle cx="1094" cy="143" r="2" /><circle cx="1220" cy="282" r="2" />
    </svg>
  );
}

export default function LandingPage() {
  return (
    <main className="landing-page">
      <header className="landing-nav">
        <BrandLogo className="landing-brand" href="/" label="ValueInsight 首页" />
        <nav aria-label="主导航"><a href="#technology">技术栈</a></nav>
        <div className="landing-nav-actions">
          <Link className="landing-button landing-button-quiet" href="/sign-in">Sign In</Link>
          <Link className="landing-button landing-button-hot" href="/sign-up">Sign Up</Link>
        </div>
      </header>

      <section className="landing-hero" aria-labelledby="landing-title">
        <Starfield />
        <div className="landing-orbit landing-orbit-one" aria-hidden="true" />
        <div className="landing-orbit landing-orbit-two" aria-hidden="true" />
        <div className="landing-copy">
          <h1 id="landing-title"><span>把复杂市场</span><br />转化为清晰判断。</h1>
          <p>从公司基本面、市场预期到 DCF 估值，在一处完成你的投资研究。</p>
          <div className="landing-hero-actions">
            <Link className="landing-button landing-button-hot" href="/sign-up">Sign Up <span aria-hidden="true">↗</span></Link>
            <Link className="landing-button landing-button-outline" href="/sign-in">Sign In</Link>
          </div>
        </div>
        <div className="landing-hero-foot"><span>VALUEINSIGHT / INVESTMENT RESEARCH</span><span>RESEARCH WITH A POINT OF VIEW</span></div>
      </section>

      <section className="landing-tech" id="technology" aria-labelledby="technology-title">
        <h2 id="technology-title">为研究工作而构建</h2>
        <p>一套轻量、可靠的现代技术栈，支撑你的研究流程。</p>
        <ul>{stack.map((item) => <li key={item}>{item}</li>)}</ul>
      </section>
    </main>
  );
}
