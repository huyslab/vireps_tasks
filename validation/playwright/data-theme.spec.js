import { expect, test } from '@playwright/test';

const parseRgb = (value) => value.match(/[\d.]+/g).slice(0, 3).map(Number);

const relativeLuminance = (rgb) => {
  const [red, green, blue] = rgb.map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
};

const contrastRatio = (first, second) => {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (lighter + 0.05) / (darker + 0.05);
};

async function loadThemeFixture(page, markup) {
  await page.goto('/index.html');
  await page.evaluate((html) => {
    document.body.style.cssText = 'margin: 0;';
    document.body.innerHTML = `<div class="jspsych-display-element">${html}</div>`;
  }, markup);
}

test('three-column coin legends fit the instruction column on a narrow phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await loadThemeFixture(
    page,
    `<div class="instructions" style="width: var(--rlm-measure)">
      <table class="rlm-coin-table"><tbody><tr>
        <td><img src="/assets/images/card-choosing/outcomes/1pound.png" style="width:100px;height:100px"></td>
        <td><img src="/assets/images/card-choosing/outcomes/50pence.png" style="width:100px;height:100px"></td>
        <td><img src="/assets/images/card-choosing/outcomes/1penny.png" style="width:100px;height:100px"></td>
      </tr></tbody></table>
    </div>`
  );

  await expect(page.locator('.rlm-coin-table img')).toHaveCount(3);
  await expect(page.locator('.rlm-coin-table img').first()).toBeVisible();

  const geometry = await page.evaluate(() => {
    const instructions = document.querySelector('.instructions').getBoundingClientRect();
    const table = document.querySelector('.rlm-coin-table').getBoundingClientRect();
    const images = [...document.querySelectorAll('.rlm-coin-table img')].map((image) => {
      const box = image.getBoundingClientRect();
      return {
        width: box.width,
        height: box.height,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
      };
    });
    return {
      instructions: { left: instructions.left, right: instructions.right },
      table: { left: table.left, right: table.right },
      images,
    };
  });

  expect(geometry.table.left).toBeGreaterThanOrEqual(geometry.instructions.left);
  expect(geometry.table.right).toBeLessThanOrEqual(geometry.instructions.right);
  for (const image of geometry.images) {
    expect(image.width).toBeLessThanOrEqual(100);
    expect(
      Math.abs(image.width / image.height - image.naturalWidth / image.naturalHeight),
      'coin images should retain their intrinsic aspect ratio'
    ).toBeLessThan(0.01);
  }
});

test('disabled primary buttons retain an accessible text contrast', async ({ page }) => {
  await loadThemeFixture(page, '<button class="jspsych-btn" disabled>Next &gt;</button>');

  const colors = await page.locator('.jspsych-btn').evaluate((button) => {
    const styles = getComputedStyle(button);
    return { foreground: styles.color, background: styles.backgroundColor };
  });

  expect(contrastRatio(parseRgb(colors.foreground), parseRgb(colors.background))).toBeGreaterThanOrEqual(4.5);
});
