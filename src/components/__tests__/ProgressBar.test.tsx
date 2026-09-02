/**
 * ProgressBar semantic timer: reduced motion must not collapse the countdown.
 */

import React from 'react';
import { act, create } from 'react-test-renderer';
import {
  ReduceMotion,
  cancelAnimation,
  withTiming,
} from 'react-native-reanimated';

const pendingTimers: Array<{
  duration: number;
  callback?: (finished: boolean) => void;
}> = [];

jest.mock('@shopify/react-native-skia', () => ({
  Canvas: ({ children }: { children?: unknown }) => children ?? null,
  Rect: (): null => null,
}));

jest.mock('../../theme/components.ts', () => {
  const ReactLib = require('react');
  const ReactNative = require('react-native');
  return {
    View: ({
      children,
      onLayout,
      ...props
    }: {
      children?: unknown;
      onLayout?: (event: {
        nativeEvent: { layout: { width: number; height: number } };
      }) => void;
    }) => {
      const notified = ReactLib.useRef(false);
      ReactLib.useEffect(() => {
        if (notified.current || !onLayout) {
          return;
        }
        notified.current = true;
        onLayout({ nativeEvent: { layout: { width: 200, height: 6 } } });
      }, [onLayout]);
      return ReactLib.createElement(ReactNative.View, props, children);
    },
  };
});

import ProgressBar from '../ProgressBar';

const fireElapsed = (ms: number): void => {
  const due = pendingTimers.filter(pending => pending.duration <= ms);
  due.forEach(pending => {
    const index = pendingTimers.indexOf(pending);
    if (index >= 0) {
      pendingTimers.splice(index, 1);
    }
    pending.callback?.(true);
  });
};

describe('ProgressBar semantic timer', () => {
  beforeEach(() => {
    pendingTimers.length = 0;
    jest.clearAllMocks();
    jest.useFakeTimers();
    (withTiming as jest.Mock).mockImplementation(
      (
        value: number,
        config?: { duration?: number; reduceMotion?: string },
        callback?: (finished: boolean) => void,
      ) => {
        if (config?.reduceMotion !== 'never' && callback) {
          callback(true);
          return value;
        }
        pendingTimers.push({ duration: config?.duration ?? 0, callback });
        return value;
      },
    );
    (cancelAnimation as jest.Mock).mockImplementation(() => {
      pendingTimers.splice(0).forEach(pending => {
        pending.callback?.(false);
      });
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const mountBar = async (
    element: React.ReactElement,
  ): Promise<ReturnType<typeof create>> => {
    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(element);
    });
    await act(async () => {
      jest.runOnlyPendingTimers();
    });
    return renderer!;
  };

  it('configures the countdown with ReduceMotion.Never', async () => {
    await mountBar(<ProgressBar duration={60000} onComplete={jest.fn()} />);
    expect(withTiming).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        duration: 60000,
        reduceMotion: ReduceMotion.Never,
      }),
      expect.any(Function),
    );
  });

  it('does not complete before 59999ms and completes once at 60000ms', async () => {
    const onComplete = jest.fn();
    await mountBar(<ProgressBar duration={60000} onComplete={onComplete} />);
    await act(async () => {
      fireElapsed(59999);
    });
    expect(onComplete).not.toHaveBeenCalled();
    await act(async () => {
      fireElapsed(60000);
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
    await act(async () => {
      fireElapsed(60000);
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('does not call onComplete when cancelled or unmounted', async () => {
    const onComplete = jest.fn();
    const renderer = await mountBar(
      <ProgressBar duration={60000} onComplete={onComplete} />,
    );
    await act(async () => {
      renderer.unmount();
    });
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('does not restart the countdown when only the callback identity changes', async () => {
    const first = jest.fn();
    const second = jest.fn();
    const renderer = await mountBar(
      <ProgressBar duration={60000} onComplete={first} />,
    );
    const callsAfterMount = (withTiming as jest.Mock).mock.calls.length;
    await act(async () => {
      renderer.update(<ProgressBar duration={60000} onComplete={second} />);
    });
    expect((withTiming as jest.Mock).mock.calls.length).toBe(callsAfterMount);
    await act(async () => {
      fireElapsed(60000);
    });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('does not collapse the timer when a reduced-motion mock would finish immediately', async () => {
    const onComplete = jest.fn();
    await mountBar(<ProgressBar duration={60000} onComplete={onComplete} />);
    const config = (withTiming as jest.Mock).mock.calls.find(
      (call: unknown[]) => call[0] === 1,
    )?.[1] as { reduceMotion?: string };
    expect(config.reduceMotion).toBe(ReduceMotion.Never);
    expect(onComplete).not.toHaveBeenCalled();
  });
});
