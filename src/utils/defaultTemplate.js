// 사용자 확정 양식 기반 기본 마스터 템플릿
export const RAW_CSV_MASTER = `구분,순서,체크 항목,이슈사항,비고,필수,item_id,category_id,sort_order,source_row,active
PC 세팅,1,공유기 IP 변경 (192.168.0.2),,,Y,MMI-PC-001,PC_SETUP,10,4,Y
PC 세팅,2,방화벽 OFF,,,Y,MMI-PC-002,PC_SETUP,20,5,Y
PC 세팅,3,SESS) 설정 > firewall & network protection > 도메인 네트워크 끄기,,,Y,MMI-PC-003,PC_SETUP,30,6,Y
PC 세팅,4,"센서 화면 언어 깨짐 확인 | Date & Time > local은 korean, utf-8 체크 해제",,,Y,MMI-PC-004,PC_SETUP,40,7,Y
PC 세팅,5,현지 시간대 설정,,,Y,MMI-PC-005,PC_SETUP,50,8,Y
PC 세팅,6,공유기 DHCP OFF | 192.168.0.1 접속 후 변경,,,Y,MMI-PC-006,PC_SETUP,60,9,Y
PC 세팅,7,adjust clearType,,,Y,MMI-PC-007,PC_SETUP,70,10,Y
PC 세팅,8,handy barcode 자동 엔터 세팅,,,Y,MMI-PC-008,PC_SETUP,80,11,Y
PC 세팅,9,터치 / 키보드 / 마우스 이슈,,,Y,MMI-PC-009,PC_SETUP,85,12,Y
키엔스 2D 바코드,1,IP 변경,,,Y,MMI-2D-001,KEYENCE_2D,90,15,Y
키엔스 2D 바코드,2,뱅크 저장,,,Y,MMI-2D-002,KEYENCE_2D,100,16,Y
키엔스 2D 바코드,3,동작 - 원샷 트리거,,,Y,MMI-2D-003,KEYENCE_2D,110,17,Y
키엔스 2D 바코드,4,튜닝 설정 - AI 필터 OFF,,,Y,MMI-2D-004,KEYENCE_2D,120,18,Y
키엔스 2D 바코드,5,자재 및 MMI 확인,,,Y,MMI-2D-005,KEYENCE_2D,130,19,Y
키엔스 2D 바코드,6,바코드 셋업 파일 백업,,,Y,MMI-2D-006,KEYENCE_2D,140,20,Y
키엔스 2D 바코드,7,멀티 바코드) 뱅크 - 기타사항 - 판독 코드 수 / 설정 코드 개수보다 적은 코드 판독 허용,,,Y,MMI-2D-007,KEYENCE_2D,150,21,Y
키엔스 2D 바코드,8,멀티 바코드) 상세설정 - 다중코드 판독 - 다중코드 출력형식 - 영역별로 변경,,,Y,MMI-2D-008,KEYENCE_2D,160,22,Y
캔탑스 RFID,1,IP 설정,,,Y,MMI-RFID-001,CANTOPS_RFID,170,26,Y
캔탑스 RFID,2,CH 1인지 확인,,,Y,MMI-RFID-002,CANTOPS_RFID,180,27,Y
캔탑스 RFID,3,MMI 및 자재 확인,,,Y,MMI-RFID-003,CANTOPS_RFID,190,28,Y
FFU,1,FFU 본체가 REMOTE로 스위치되어 있는지 확인,,,Y,MMI-FFU-001,FFU,200,33,Y
FFU,2,COMPORT 확인,,,Y,MMI-FFU-002,FFU,210,34,Y
FFU,3,LOW 1 설정,,,Y,MMI-FFU-003,FFU,220,35,Y
FFU,4,COMM.ini COM 확인,,,Y,MMI-FFU-004,FFU,230,36,Y
FFU,5,MMI 확인,,,Y,MMI-FFU-005,FFU,240,37,Y
화재감지기,1,센서 전원 / COM port 확인,,,Y,MMI-FIRE-001,FIRE_SENSOR,250,41,Y
화재감지기,2,딥스위치 변경,,,Y,MMI-FIRE-002,FIRE_SENSOR,260,42,Y
화재감지기,3,MMI 프로그램 확인,,,Y,MMI-FIRE-003,FIRE_SENSOR,270,43,Y
통신 GEM (01),1,XGEM 설치,,,Y,MMI-GEM-001,GEM_01,280,47,Y
통신 GEM (01),2,IP 설정,,,Y,MMI-GEM-002,GEM_01,290,48,Y
통신 GEM (01),3,HOST 연결 확인,,,Y,MMI-GEM-003,GEM_01,300,49,Y
통신 GEM (01),4,통신 로그 확인,,,Y,MMI-GEM-004,GEM_01,310,50,Y
통신 GEM (01),5,GEM 키 연결,,,Y,MMI-GEM-005,GEM_01,320,51,Y
키엔스 Thickness Sensor,1,MMI 프로그램에서 값이 들어오는지 확인,,,Y,MMI-THK-001,KEYENCE_THICKNESS,330,55,Y
키엔스 Thickness Sensor,2,DL-EN1 IP 설정,,,Y,MMI-THK-002,KEYENCE_THICKNESS,340,56,Y
파나소닉 Height Sensor,1,COMPORT 확인,,,Y,MMI-HGT-001,PANASONIC_HEIGHT,350,60,Y
파나소닉 Height Sensor,2,MMI 값 수신 확인,,,Y,MMI-HGT-002,PANASONIC_HEIGHT,360,61,Y
통신 GEM (02),1,XGEM 설치,,,Y,MMI-GEM-006,GEM_02,370,65,Y
통신 GEM (02),2,통신 로그 확인,,,Y,MMI-GEM-007,GEM_02,380,66,Y`;

export function parseCsvToTemplate(csvText, templateName = "MMI 셋업 리스트 (공통 마스터)", version = "v1.0") {
  const lines = csvText.split(/\r?\n/);
  const categoriesMap = new Map();
  let headerIndex = -1;
  let headers = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i].trim();
    if (!rawLine) continue;

    // CSV 행 분리 (따옴표 고려)
    const row = parseCsvLine(rawLine);
    if (!row || row.length === 0) continue;

    // 헤더 행 감지
    if (row.includes('구분') && row.includes('체크 항목')) {
      headerIndex = i;
      headers = row.map((h) => h.trim());
      continue;
    }

    if (headerIndex === -1) continue; // 헤더 이전 행 스킵

    const getVal = (name) => {
      const idx = headers.indexOf(name);
      return idx >= 0 && row[idx] !== undefined ? String(row[idx]).trim() : '';
    };

    const categoryName = getVal('구분') || row[0]?.trim();
    const itemName = getVal('체크 항목') || row[2]?.trim();
    if (!categoryName || !itemName) continue;

    const itemId = getVal('item_id') || `ITEM_${categoryName}_${itemName}`;
    const categoryId = getVal('category_id') || categoryName;
    const note = getVal('비고');
    const issue = getVal('이슈사항');
    const orderStr = getVal('순서');
    const order = orderStr ? parseInt(orderStr, 10) : 0;

    if (!categoriesMap.has(categoryName)) {
      categoriesMap.set(categoryName, {
        name: categoryName,
        categoryId,
        items: [],
      });
    }

    const cat = categoriesMap.get(categoryName);
    cat.items.push({
      id: itemId, // 고유 식별자 키
      name: itemName,
      criteria: note || issue || '',
      note: note || '',
      issue: issue || '',
      order: isNaN(order) ? cat.items.length + 1 : order,
      inputType: 'status',
    });
  }

  return {
    name: templateName,
    version,
    categories: Array.from(categoriesMap.values()),
  };
}

// 따옴표 지원 CSV 한 줄 파서
function parseCsvLine(text) {
  const result = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (inQuotes && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(cur);
      cur = '';
    } else {
      cur += char;
    }
  }
  result.push(cur);
  return result;
}

export const DEFAULT_MASTER_TEMPLATE = parseCsvToTemplate(RAW_CSV_MASTER);
