import { recognizeTimetableImage } from './fixedTimetableApi';
import { supabase } from '../lib/supabaseClient';

jest.mock('../lib/supabaseClient', () => ({
  supabase: { auth: { getSession: jest.fn() } },
}));

beforeEach(() => {
  global.fetch = jest.fn();
});
afterEach(() => jest.restoreAllMocks());

test('uploads the image through the same site with the login token', async () => {
  supabase.auth.getSession.mockResolvedValue({ data: { session: { access_token: 'test-token' } } });
  const classes = [{ weekday: 1, starttime: '09:00', endtime: '10:00' }];
  global.fetch.mockResolvedValue({ ok: true, json: async () => ({ classes, partial: false }) });
  const file = new File(['image'], 'timetable.png', { type: 'image/png' });
  await expect(recognizeTimetableImage(file)).resolves.toEqual({ classes, partial: false });
  const [url, options] = global.fetch.mock.calls[0];
  expect(url).toBe('/api/timetable/ocr');
  expect(options.headers.Authorization).toBe('Bearer test-token');
  expect(options.body.get('image')).toEqual(file);
});

test('asks for login before uploading when the session has expired', async () => {
  supabase.auth.getSession.mockResolvedValue({ data: { session: null } });
  await expect(recognizeTimetableImage(new File(['image'], 'timetable.png'))).rejects.toThrow('다시 로그인');
  expect(global.fetch).not.toHaveBeenCalled();
});
