import { CuteFlower } from "@/app/components/icons";

interface HeroBlockProps {
  totalCount: number;
}

export function HeroBlock({ totalCount }: HeroBlockProps) {
  const insectWord = totalCount === 1 ? "insect" : "insects";
  return (
    <header className="home-header">
      <h1 className="home-title">
        line of bugs <CuteFlower size={44} className="home-title-icon" loading="eager" />
      </h1>
      <p className="home-tagline">
        gesture drawing practice with <span className="home-tagline-count">{totalCount.toLocaleString()}</span> {insectWord}, tenderly photographed
      </p>
    </header>
  );
}
