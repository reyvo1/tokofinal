const CODE128_PATTERNS = [
  '212222','222122','222221','121223','121322','131222','122213','122312','132212','221213','221312','231212','112232','122132','122231','113222','123122','123221','223211','221132','221231','213212','223112','312131','311222','321122','321221','312212','322112','322211','212123','212321','232121','111323','131123','131321','112313','132113','132311','211313','231113','231311','112133','112331','132131','113123','113321','133121','313121','211331','231131','213113','213311','213131','311123','311321','331121','312113','312311','332111','314111','221411','431111','111224','111422','121124','121421','141122','141221','112214','112412','122114','122411','142112','142211','241211','221114','413111','241112','134111','111242','121142','121241','114212','124112','124211','411212','421112','421211','212141','214121','412121','111143','111341','131141','114113','114311','411113','411311','113141','114131','311141','411131','211412','211214','211232','2331112',
] as const;

export type Code128Bar = { x: number; width: number };
export type Code128Layout = { bars: Code128Bar[]; width: number; height: number; text: string };

export function code128B(value: string, moduleWidth = 2, height = 48): Code128Layout {
  if (!value || [...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) > 126)) {
    throw new Error('Code128-B hanya menerima karakter ASCII 32-126.');
  }
  const values = [...value].map((char) => char.charCodeAt(0) - 32);
  let checksum = 104;
  values.forEach((item, index) => { checksum += item * (index + 1); });
  const symbols = [104, ...values, checksum % 103, 106];
  const quiet = 10 * moduleWidth;
  let cursor = quiet;
  const bars: Code128Bar[] = [];
  for (const symbol of symbols) {
    const pattern = CODE128_PATTERNS[symbol];
    let black = true;
    for (const digit of pattern) {
      const width = Number(digit) * moduleWidth;
      if (black) bars.push({ x: cursor, width });
      cursor += width;
      black = !black;
    }
  }
  return { bars, width: cursor + quiet, height, text: value };
}
