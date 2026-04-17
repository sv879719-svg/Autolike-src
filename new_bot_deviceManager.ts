export function getRandomDevice() {
  const models = [
    'SM-G973F', 'SM-G981B', 'SM-G991B', 'Pixel 5', 'Pixel 6', 'Pixel 7', 
    'OnePlus 8', 'OnePlus 9', 'OnePlus 10 Pro', 'Mi 11'
  ];
  const androidVersions = ['10', '11', '12', '13'];
  
  return {
    model: models[Math.floor(Math.random() * models.length)],
    androidVersion: androidVersions[Math.floor(Math.random() * androidVersions.length)],
    userAgent: `Mozilla/5.0 (Linux; Android ${androidVersions[Math.floor(Math.random() * androidVersions.length)]}; ${models[Math.floor(Math.random() * models.length)]}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${Math.floor(Math.random() * 20) + 90}.0.0.0 Mobile Safari/537.36`
  };
}
