type DeferredHandoffDelete = {
	timer: ReturnType<typeof setTimeout>;
	pubky: string;
};

const deferredHandoffDeletes = new Set<DeferredHandoffDelete>();

export const unrefTimerIfPossible = (timer: ReturnType<typeof setTimeout>): void => {
	const maybeUnref = (timer as unknown as { unref?: () => void }).unref;
	if (typeof maybeUnref === 'function') {
		maybeUnref.call(timer);
	}
};

/**
 * Drop pending +5 min handoff DELETEs. Pass `pubky` to cancel only that
 * identity's timers (sign-out / delete). Omit it to cancel all (wipe).
 */
export const cancelDeferredHandoffDeletes = (pubky?: string): void => {
	for (const entry of [...deferredHandoffDeletes]) {
		if (pubky !== undefined && entry.pubky !== pubky) {
			continue;
		}
		clearTimeout(entry.timer);
		deferredHandoffDeletes.delete(entry);
	}
};

export const trackDeferredHandoffDelete = (entry: DeferredHandoffDelete): void => {
	deferredHandoffDeletes.add(entry);
};

export const untrackDeferredHandoffDelete = (entry: DeferredHandoffDelete): void => {
	deferredHandoffDeletes.delete(entry);
};
