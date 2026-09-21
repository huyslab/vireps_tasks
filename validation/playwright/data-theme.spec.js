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

async function loadPiggyBankThemeFixture(page, markup) {
  await loadThemeFixture(page, markup);
  await page.addStyleTag({ url: '/tasks/piggy-banks/styles.css' });
}

test('PIT background and coin rows have comfortable spacing on a tablet', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  const image =
    'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

  await loadPiggyBankThemeFixture(
    page,
    `<div class="instructions"><div id="instruction-text">
      <div class="pav-stimuli-container">
        <div class="pit-pav-row">
          ${Array.from({ length: 3 }, () => `<img src="${image}" class="pit-pav-icon">`).join('')}
          <div class="vertical"></div>
          ${Array.from({ length: 3 }, () => `<img src="${image}" class="pit-pav-icon">`).join('')}
        </div>
        <div class="pit-coin-row">
          ${Array.from({ length: 3 }, () => `<img src="${image}" class="pit-coin-icon">`).join('')}
          <div class="vertical"></div>
          ${Array.from({ length: 3 }, () => `<img src="${image}" class="pit-coin-icon">`).join('')}
        </div>
      </div>
    </div></div>`
  );

  const layout = await page.evaluate(() => {
    const measure = (selector) =>
      [...document.querySelectorAll(selector)].map((element) => {
        const box = element.getBoundingClientRect();
        return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
      });
    return {
      container: document.querySelector('.pav-stimuli-container').getBoundingClientRect().toJSON(),
      backgrounds: measure('.pit-pav-icon'),
      coins: measure('.pit-coin-icon'),
    };
  });

  for (const row of [layout.backgrounds, layout.coins]) {
    expect(row[0].left).toBeGreaterThanOrEqual(layout.container.left);
    expect(row.at(-1).right).toBeLessThanOrEqual(layout.container.right);
    for (let index = 1; index < row.length; index += 1) {
      expect(row[index].left - row[index - 1].right).toBeGreaterThanOrEqual(20);
    }
  }
  expect(layout.coins[0].top - layout.backgrounds[0].bottom).toBeGreaterThanOrEqual(20);
});

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
