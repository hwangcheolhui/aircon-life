// T-WRK-020 작업 사진 · F-TEC-WRK-03: 기기별 작업 전/후(필수, BR-041), 이상 발견·안전(선택). 카메라 직접 촬영(WORK_PHOTO_CAMERA_ONLY=Y면 갤러리 제한)
import { cameraOnly } from '@/server/work';
import { PhotoBoard } from '@/tech/work/photo-board';
import { WorkSteps } from '@/tech/work/work-steps';
import { loadStep } from '../load';

export const metadata = { title: '작업 사진' };

export default async function WorkPhotosPage({ params }: { params: Promise<{ orderNo: string }> }) {
  const { orderNo } = await params;
  const { s } = await loadStep(orderNo, 'photos');
  return (
    <main className="tec-page__body">
      <WorkSteps orderNo={orderNo} current="photos" title="작업 사진" />
      <p className="ac-caption">작업 전에 기기마다 사진을 찍고, 작업이 끝나면 같은 자리에서 작업 후 사진을 찍어 주세요. 신호가 약해도 사진은 저장되고 연결되면 올라갑니다.</p>
      <PhotoBoard orderNo={orderNo} units={s.units} photos={s.photos} cameraOnly={await cameraOnly()} editable />
    </main>
  );
}
