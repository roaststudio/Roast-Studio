import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-xs font-medium ring-offset-background transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 uppercase tracking-wider border-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground border-primary hover:brightness-125 shadow-[4px_4px_0_hsl(0_0%_0%),inset_-2px_-2px_0_hsl(120_100%_30%),inset_2px_2px_0_hsl(120_100%_70%)]",
        destructive: "bg-destructive text-destructive-foreground border-destructive hover:brightness-125 shadow-[4px_4px_0_hsl(0_0%_0%)]",
        outline: "border-primary bg-transparent text-primary hover:bg-primary/20 shadow-[4px_4px_0_hsl(0_0%_0%)]",
        secondary: "bg-secondary text-secondary-foreground border-secondary hover:brightness-125 shadow-[4px_4px_0_hsl(0_0%_0%)]",
        ghost: "text-foreground hover:bg-muted border-transparent hover:border-primary",
        link: "text-primary underline-offset-4 hover:underline border-transparent",
        neon: "bg-primary text-primary-foreground border-primary shadow-[4px_4px_0_hsl(0_0%_0%),0_0_20px_hsl(120_100%_50%/0.5)] hover:shadow-[4px_4px_0_hsl(0_0%_0%),0_0_40px_hsl(120_100%_50%/0.8)] transition-shadow duration-300",
        studio: "bg-card border-border text-foreground hover:border-primary hover:shadow-[0_0_20px_hsl(120_100%_50%/0.3)] shadow-[4px_4px_0_hsl(0_0%_0%)]",
        record: "bg-destructive text-destructive-foreground border-destructive shadow-[4px_4px_0_hsl(0_0%_0%),0_0_20px_hsl(0_100%_50%/0.5)] animate-pulse",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 px-3 text-[10px]",
        lg: "h-12 px-8 text-sm",
        xl: "h-14 px-10 text-sm",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
