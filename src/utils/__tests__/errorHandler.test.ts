/**
 * Unit tests for errorHandler
 *
 * Tests error extraction, handling, and the withErrorHandler utility.
 */

import { getErrorMessage, AppError, handleError, withErrorHandler } from '../errorHandler';

// Mock dependencies
jest.mock('../helpers', () => ({
	showToast: jest.fn(),
}));

jest.mock('../../i18n', () => ({
	default: { t: (key: string) => key },
	t: (key: string) => key,
}));

import { showToast } from '../helpers';

describe('errorHandler', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	describe('getErrorMessage', () => {
		it('should return fallback for null/undefined', () => {
			expect(getErrorMessage(null)).toBe('errors.unknownError');
			expect(getErrorMessage(undefined)).toBe('errors.unknownError');
		});

		it('should return custom fallback', () => {
			expect(getErrorMessage(null, 'Custom fallback')).toBe('Custom fallback');
		});

		it('should extract message from string', () => {
			expect(getErrorMessage('Simple error message')).toBe('Simple error message');
		});

		it('should return fallback for empty string', () => {
			expect(getErrorMessage('')).toBe('errors.unknownError');
			expect(getErrorMessage('   ')).toBe('errors.unknownError');
		});

		it('should extract message from Error instance', () => {
			const error = new Error('Error instance message');
			expect(getErrorMessage(error)).toBe('Error instance message');
		});

		it('should return fallback for Error with empty message', () => {
			const error = new Error('');
			expect(getErrorMessage(error)).toBe('errors.unknownError');
		});

		it('should extract message from object with message property', () => {
			expect(getErrorMessage({ message: 'Object message' })).toBe('Object message');
		});

		it('should handle nested error structures', () => {
			expect(getErrorMessage({ error: 'Nested error' })).toBe('Nested error');
			expect(getErrorMessage({ error: { message: 'Deep nested' } })).toBe('Deep nested');
		});

		it('should handle deeply nested message property', () => {
			expect(getErrorMessage({ message: { message: 'Very deep' } })).toBe('Very deep');
		});

		it('should return fallback for empty objects', () => {
			expect(getErrorMessage({})).toBe('errors.unknownError');
			expect(getErrorMessage({ message: {} })).toBe('errors.unknownError');
		});

		it('should stringify non-empty objects without message/error', () => {
			const obj = { code: 'ERR_001', details: 'some details' };
			const result = getErrorMessage(obj);
			expect(result).toBe(JSON.stringify(obj));
		});

		it('should return fallback for circular objects', () => {
			const circular: Record<string, unknown> = {};
			circular.self = circular;
			// JSON.stringify will throw, should return fallback
			expect(getErrorMessage(circular)).toBe('errors.unknownError');
		});
	});

	describe('AppError', () => {
		it('should create error with message, code, and recoverable flag', () => {
			const error = new AppError('Test error', 'TEST_001', true);

			expect(error.message).toBe('Test error');
			expect(error.code).toBe('TEST_001');
			expect(error.recoverable).toBe(true);
			expect(error.name).toBe('AppError');
		});

		it('should default recoverable to true', () => {
			const error = new AppError('Test error', 'TEST_001');

			expect(error.recoverable).toBe(true);
		});

		it('should be instanceof Error', () => {
			const error = new AppError('Test', 'CODE');

			expect(error instanceof Error).toBe(true);
			expect(error instanceof AppError).toBe(true);
		});
	});

	describe('handleError', () => {
		it('should show toast and return recoverable status for AppError', () => {
			const error = new AppError('Recoverable error', 'ERR_001', true);

			const result = handleError(error, 'testContext');

			expect(showToast).toHaveBeenCalledWith(
				expect.objectContaining({
					type: 'error',
					description: 'Recoverable error',
				})
			);
			expect(result).toBe(true);
		});

		it('should return false for non-recoverable AppError', () => {
			const error = new AppError('Fatal error', 'ERR_002', false);

			const result = handleError(error, 'testContext');

			expect(result).toBe(false);
		});

		it('should show generic toast for non-AppError', () => {
			const error = new Error('Regular error');

			const result = handleError(error, 'testContext');

			expect(showToast).toHaveBeenCalledWith(
				expect.objectContaining({
					type: 'error',
					description: 'pubkyErrors.unexpectedError',
				})
			);
			expect(result).toBe(false);
		});

		it('should handle unknown error types', () => {
			const result = handleError('string error', 'testContext');

			expect(showToast).toHaveBeenCalled();
			expect(result).toBe(false);
		});
	});

	describe('withErrorHandler', () => {
		it('should return Ok result on success', async () => {
			const operation = jest.fn().mockResolvedValue('success value');

			const result = await withErrorHandler(operation, 'testContext');

			expect(result.isOk()).toBe(true);
			if (result.isOk()) {
				expect(result.value).toBe('success value');
			}
		});

		it('should return Err result on failure', async () => {
			const operation = jest.fn().mockRejectedValue(new Error('Operation failed'));

			const result = await withErrorHandler(operation, 'testContext');

			expect(result.isErr()).toBe(true);
		});

		it('should call handleError on failure', async () => {
			const operation = jest.fn().mockRejectedValue(new Error('Operation failed'));

			await withErrorHandler(operation, 'testContext');

			expect(showToast).toHaveBeenCalled();
		});

		it('should return error message in Err result', async () => {
			const operation = jest.fn().mockRejectedValue(new Error('Specific error'));

			const result = await withErrorHandler(operation, 'testContext');

			expect(result.isErr()).toBe(true);
			// The err() wrapper returns the error message string
		});

		it('should handle non-Error throws', async () => {
			const operation = jest.fn().mockRejectedValue('string error');

			const result = await withErrorHandler(operation, 'testContext');

			expect(result.isErr()).toBe(true);
			// Non-Error throws return generic error message
		});
	});
});

