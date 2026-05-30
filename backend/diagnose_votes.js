const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

async function diagnose() {
  // KST 시간 (UTC + 9)
  const now = new Date();
  const kstOffset = 9 * 60 * 60 * 1000;
  const kstNow = new Date(now.getTime() + kstOffset);
  const kstIso = kstNow.toISOString().replace('Z', ''); // 'Z'를 제거하여 DB의 포맷과 맞춤
  
  console.log('현재 시간 (UTC):', now.toISOString());
  console.log('현재 시간 (KST):', kstIso);

  // 1. 만료된 투표가 있는지 단순 조회해보기
  const { data: expiredVotes, error } = await supabase
    .from("votes")
    .select("id, title, endtime, isclosed, endtimeenabled")
    .eq("endtimeenabled", true)
    .lte("endtime", kstIso) // KST 시간으로 비교
    .eq("isclosed", false);

  if (error) {
    console.error('조회 중 오류 발생:', error);
    return;
  }

  console.log('마감되어야 할 투표 개수:', expiredVotes.length);
  expiredVotes.forEach(v => {
    console.log(`- [${v.id}] ${v.title} | 마감시간: ${v.endtime} | 현재상태: ${v.isclosed}`);
  });

  if (expiredVotes.length > 0) {
    console.log('업데이트 시도 중...');
    const { data: updated, error: updateError } = await supabase
      .from("votes")
      .update({ isclosed: true })
      .in("id", expiredVotes.map(v => v.id))
      .select();

    if (updateError) {
      console.error('업데이트 중 오류 발생:', updateError);
    } else {
      console.log('업데이트 성공 개수:', updated.length);
    }
  }
}

diagnose();
