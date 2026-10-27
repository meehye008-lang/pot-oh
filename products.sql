-- =====================================================================
-- products.sql : 추천 상품 카드 2개 넣기 (DB손해보험)
--
-- 사용법
--   Supabase > SQL Editor 에 전체를 붙여 넣고 Run 한다. (몇 번 실행해도 같은 카드가 두 번 생기지 않음)
--
-- 하는 일
--   1) resume.sql 이 넣었던 예시 카드 4개를 지운다. (그 카드의 좋아요도 함께 지워짐)
--   2) 추천 상품 카드 2개를 넣는다.
--   썸네일 이미지와 첨부 파일은 SQL로 올릴 수 없으니, 실행한 뒤 관리자 페이지에서
--   각 카드의 "수정"을 눌러 올린다.
-- =====================================================================


-- 1. 예시 카드 지우기 (제목이 '예시'로 시작하는 카드만)
delete from public.projects
where title in (
  '예시 AI 챗봇 프로젝트',
  '예시 채용 플랫폼',
  '예시 헬스케어 앱 운영',
  '예시 쇼핑몰 통합 운영'
);


-- 2. 추천 상품 카드 넣기 (같은 제목의 카드가 이미 있으면 넣지 않는다)
insert into public.projects (number, category, title, description, tags, sort_order)
select v.number, v.category, v.title, v.description, v.tags, v.sort_order
from (values
  ('01', '간편 건강보험',
   '초경증 간편 건강보험 3.8.5 · 대상포진 1만원대 플랜',
   '대상포진진단비 2백만원(최초 1회한) 포함 7개 담보, 50세 여자·1급 기준 월 보험료 합계 14,834원. 보험료는 예시이며 가입조건에 따라 달라질 수 있습니다.',
   array['DB손해보험', '간편고지', '대상포진'], 1),
  ('02', '건강보험',
   '가입 추천 플랜 · 대상포진·통풍 진단비',
   '대상포진 진단 확정 시 300만원, 통풍 진단 확정 시 200만원(가입금액 지급). 보장내용·보험료·가입조건은 상품별로 다를 수 있습니다.',
   array['DB손해보험', '대상포진', '통풍'], 2)
) as v(number, category, title, description, tags, sort_order)
where not exists (
  select 1 from public.projects p where p.title = v.title
);
