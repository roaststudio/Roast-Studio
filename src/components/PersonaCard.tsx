interface PersonaCardProps {
  name: string;
  avatar?: string;
  status: string;
  twitterHandle?: string;
}

export function PersonaCard({ name, avatar, status, twitterHandle }: PersonaCardProps) {
  const statusColors = {
    OPEN: "bg-neon-cyan text-primary-foreground",
    LOCKED: "bg-neon-yellow text-primary-foreground",
    LIVE: "bg-accent text-accent-foreground animate-pulse",
    ARCHIVED: "bg-muted text-muted-foreground",
  };

  return (
    <div className="flex flex-col items-center gap-3 fade-in-up">
      {/* Avatar */}
      <div className="relative">
        <div className="w-20 h-20 md:w-28 md:h-28 rounded-full overflow-hidden border-3 border-primary shadow-neon-cyan animate-float">
          {avatar ? (
            <img 
              src={avatar} 
              alt={name} 
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full bg-gradient-neon flex items-center justify-center">
              <span className="font-display text-2xl md:text-4xl text-primary-foreground">
                {name.charAt(0).toUpperCase()}
              </span>
            </div>
          )}
        </div>
        {/* Glow effect */}
        <div className="absolute inset-0 rounded-full bg-primary/20 blur-xl -z-10" />
      </div>

      {/* Name */}
      <div className="text-center">
        <h2 className="font-display text-2xl md:text-3xl text-gradient-neon tracking-wider">
          {name}
        </h2>
        {twitterHandle && (
          <a 
            href={`https://twitter.com/${twitterHandle.replace('@', '')}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-primary transition-colors text-xs"
          >
            {twitterHandle}
          </a>
        )}
      </div>

      {/* Status Badge */}
      <span className={`px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider ${statusColors[status as keyof typeof statusColors] || statusColors.OPEN}`}>
        {status === "LIVE" && "🔴 "}{status}
      </span>
    </div>
  );
}