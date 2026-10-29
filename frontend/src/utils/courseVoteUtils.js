function asNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const numeric = Number(value ?? fallback);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function normalizeCourseVoteSelection(courses = []) {
  return (Array.isArray(courses) ? courses : []).map((course, index) => {
    const stops = Array.isArray(course?.stops) ? course.stops : [];
    const totalDuration = Number(
      course?.totalDurationMin ?? course?.total_duration_min ?? 0
    );
    const estimatedTravelMinutes = Number(
      course?.estimatedTravelTimeMin ?? course?.estimated_travel_time_min ??
        stops.reduce((sum, stop) => sum + Number(stop?.travelTimeFromPrevMin ?? stop?.travel_time_from_prev_min ?? 0), 0)
    );
    const estimatedCost = course?.estimatedCostPerPerson === null || stops.some(stop => stop?.estimatedCost == null && stop?.estimated_cost == null) ? null : Number(
      course?.estimatedCostPerPerson ?? course?.estimated_cost_per_person ??
        stops.reduce((sum, stop) => sum + Number(stop?.estimatedCost ?? stop?.estimated_cost ?? 0), 0)
    );
    const courseName = course?.name || course?.course_name || `추천 코스 ${index + 1}`;
    const stopCount = stops.length;
    const optionText = [
      courseName,
      stopCount ? `${stopCount}개 장소` : "",
      totalDuration ? `${totalDuration}분` : "",
    ].filter(Boolean).join(" · ");

    return {
      optiontype: "course",
      optiontext: optionText,
      optiondate: "",
      starttime: "",
      endtime: "",
      isallday: false,
      availablecount: 0,
      placename: "",
      placeaddress: "",
      placelat: "",
      placelng: "",
      kakaomapurl: "",
      courseid: course?.id ?? course?.course_id ?? `course-${index + 1}`,
      course_name: courseName,
      course_summary: course?.summary || "",
      estimated_cost: estimatedCost,
      total_duration_min: totalDuration,
      travel_time_min: estimatedTravelMinutes,
      stop_count: stopCount,
      budgetEstimate: course?.budgetEstimate || null,
      stops,
    };
  });
}

export function buildCourseVoteDbRows(course) {
  const stops = Array.isArray(course?.stops) ? course.stops : [];
  const courseName = course?.name || course?.course_name || "추천 코스";
  const recommendationCondition = course?.summary || course?.course_summary || null;

  return {
    course_name: courseName,
    recommendation_condition: recommendationCondition,
    estimated_total_duration_min: asNumber(course?.totalDurationMin ?? course?.total_duration_min ?? 0, 0),
    estimated_travel_time_min: asNumber(
      course?.estimatedTravelTimeMin ?? course?.estimated_travel_time_min ??
        stops.reduce((sum, stop) => sum + asNumber(stop?.travelTimeFromPrevMin ?? stop?.travel_time_from_prev_min ?? 0, 0), 0),
      0
    ),
    estimated_cost_per_person: course?.estimatedCostPerPerson === null || stops.some(stop => stop?.estimatedCost == null && stop?.estimated_cost == null) ? null : asNumber(course?.estimatedCostPerPerson ?? course?.estimated_cost_per_person ?? stops.reduce((sum, stop) => sum + asNumber(stop?.estimatedCost ?? stop?.estimated_cost, 0), 0), null),
    stops: stops.map((stop, index) => ({
      place_id: stop?.place_id ?? stop?.placeId ?? stop?.id ?? "",
      place_source: stop?.place_source ?? stop?.placeSource ?? "manual",
      stop_order: index + 1,
      place_name: stop?.placeName ?? stop?.place_name ?? stop?.name ?? `장소 ${index + 1}`,
      place_address: stop?.placeAddress ?? stop?.place_address ?? "",
      latitude: asNumber(stop?.latitude ?? stop?.lat ?? null, null),
      longitude: asNumber(stop?.longitude ?? stop?.lng ?? null, null),
      visit_start_time: stop?.visitStartTime ?? stop?.visit_start_time ?? null,
      visit_end_time: stop?.visitEndTime ?? stop?.visit_end_time ?? null,
      expected_stay_min: asNumber(stop?.expectedStayMin ?? stop?.expected_stay_min ?? 0, 0),
      travel_time_from_prev_min: asNumber(stop?.travelTimeFromPrevMin ?? stop?.travel_time_from_prev_min ?? 0, 0),
      distance_from_prev_m: asNumber(stop?.distanceFromPrevM ?? stop?.distance_from_prev_m ?? 0, 0),
      estimated_cost: asNumber(stop?.estimatedCost ?? stop?.estimated_cost, null),
      category: stop?.category ?? null,
      image_url: stop?.imageUrl ?? stop?.image_url ?? null,
      rating: asNumber(stop?.rating ?? null, null),
    })),
  };
}

export function getCourseVoteDefaults() {
  return {
    ismultiple: false,
    isanonymous: false,
    allowaddoption: false,
    votetype: "course",
  };
}

export function isCourseVoteType(votetype) {
  return String(votetype || "").toLowerCase() === "course";
}
