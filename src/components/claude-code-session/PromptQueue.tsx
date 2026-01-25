import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Clock, Sparkles, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface QueuedPrompt {
  id: string;
  prompt: string;
  model: "sonnet" | "opus";
}

interface PromptQueueProps {
  queuedPrompts: QueuedPrompt[];
  onRemove: (id: string) => void;
  className?: string;
}

export const PromptQueue: React.FC<PromptQueueProps> = React.memo(({
  queuedPrompts,
  onRemove,
  className
}) => {
  if (queuedPrompts.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      className={cn("border-t bg-muted/20", className)}
    >
      <div className="px-3 py-2">
        <div className="flex items-center gap-2 mb-1.5">
          <Clock className="h-3 w-3 text-muted-foreground" />
          <span className="text-xs font-medium">Queued Prompts</span>
          <Badge variant="secondary" className="h-4 text-xs px-1.5">
            {queuedPrompts.length}
          </Badge>
        </div>

        <div className="space-y-1 max-h-20 overflow-y-auto">
          <AnimatePresence mode="popLayout">
            {queuedPrompts.map((queuedPrompt, index) => (
              <motion.div
                key={queuedPrompt.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ delay: index * 0.05 }}
                className="flex items-center gap-1.5 py-1 px-2 rounded bg-background/50"
              >
                <div className="flex-shrink-0">
                  {queuedPrompt.model === "opus" ? (
                    <Sparkles className="h-3 w-3 text-purple-500" />
                  ) : (
                    <Zap className="h-3 w-3 text-amber-500" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-xs truncate">{queuedPrompt.prompt}</p>
                </div>

                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 flex-shrink-0 -mr-1"
                  onClick={() => onRemove(queuedPrompt.id)}
                >
                  <X className="h-2.5 w-2.5" />
                </Button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
});