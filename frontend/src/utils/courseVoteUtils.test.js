import { normalizeCourseVoteSelection, getCourseVoteDefaults, buildCourseVoteDbRows } from './courseVoteUtils';
import { buildCourseVoteLinkRows } from '../api/voteApi';

describe('course vote utils', () => {
  it('preserves place metadata for roadmap persistence without inventing a missing rating', () => {
    const payload = buildCourseVoteDbRows({ stops: [{ id: '123', placeName: '카페', placeSource: 'kakao', category: '카페', imageUrl: 'https://example.com/photo.jpg' }] });
    expect(payload.stops[0]).toMatchObject({ place_id: '123', place_source: 'kakao', category: '카페', image_url: 'https://example.com/photo.jpg', rating: null });
  });
  it('normalizes selected course candidates into single-select vote options', () => {
    const courses = [
      {
        id: 'course-1',
        name: '도심 산책 루트',
        summary: '식사 포함 · transit 기준',
        estimatedCostPerPerson: 23000,
        totalDurationMin: 200,
        stops: [
          { order: 1, placeName: '카페A', placeAddress: '서울시', visitStartTime: '10:00', visitEndTime: '10:50', expectedStayMin: 50, travelTimeFromPrevMin: 0, estimatedCost: 7000 },
          { order: 2, placeName: '식당B', placeAddress: '서울시', visitStartTime: '11:20', visitEndTime: '12:20', expectedStayMin: 60, travelTimeFromPrevMin: 20, estimatedCost: 12000 }
        ]
      }
    ];

    const normalized = normalizeCourseVoteSelection(courses);

    expect(normalized).toHaveLength(1);
    expect(normalized[0].optiontype).toBe('course');
    expect(normalized[0].optiontext).toContain('도심 산책 루트');
    expect(normalized[0].courseid).toBe('course-1');
    expect(normalized[0].estimated_cost).toBe(23000);
    expect(normalized[0].travel_time_min).toBe(20);
  });

  it('builds db-safe course rows with stop details for vote link persistence', () => {
    const course = {
      id: 'course-2',
      name: '저녁 데이트 코스',
      summary: '맛집 중심',
      estimatedCostPerPerson: 31000,
      totalDurationMin: 180,
      stops: [
        { order: 1, placeName: '카페', placeAddress: '서울시', latitude: 37.1, longitude: 127.1, visitStartTime: '18:00', visitEndTime: '19:00', expectedStayMin: 60, travelTimeFromPrevMin: 0, estimatedCost: 8000 },
        { order: 2, placeName: '식당', placeAddress: '서울시', latitude: 37.2, longitude: 127.2, visitStartTime: '19:20', visitEndTime: '20:40', expectedStayMin: 80, travelTimeFromPrevMin: 20, estimatedCost: 23000 },
      ],
    };

    const record = buildCourseVoteDbRows(course);
    expect(record.course_name).toBe('저녁 데이트 코스');
    expect(record.recommendation_condition).toBe('맛집 중심');
    expect(record.estimated_cost_per_person).toBe(31000);
    expect(record.stops).toHaveLength(2);
    expect(record.stops[1].stop_order).toBe(2);
    expect(record.stops[1].travel_time_from_prev_min).toBe(20);
    expect(record.stops[1].estimated_cost).toBe(23000);
  });

  it('uses single selection and non-anonymous defaults for course votes', () => {
    expect(getCourseVoteDefaults()).toEqual({
      ismultiple: false,
      isanonymous: false,
      allowaddoption: false,
      votetype: 'course',
    });
  });

  it('builds vote_course_links rows using vote_option_id and course_id, not voteid/courseid', () => {
    const rows = buildCourseVoteLinkRows({
      voteId: 42,
      voteOptions: [
        { id: 101, optiontype: 'course', optiontext: 'A코스' },
        { id: 102, optiontype: 'course', optiontext: 'B코스' },
      ],
      courseIds: [7, 8],
    });

    expect(rows).toEqual([
      { vote_id: 42, vote_option_id: 101, course_id: 7 },
      { vote_id: 42, vote_option_id: 102, course_id: 8 },
    ]);
  });
});
