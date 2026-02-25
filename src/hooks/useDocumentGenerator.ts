import { useState, useCallback } from 'react';
import PptxGenJS from 'pptxgenjs';
import { saveAs } from 'file-saver';
import type { DocumentType } from '@/types';

interface UseDocumentGeneratorReturn {
  isGenerating: boolean;
  generateDocument: (type: DocumentType, title: string, content: string) => Promise<void>;
  generatePPTX: (title: string, slides: Array<{ title: string; content: string[] }>) => Promise<void>;
  generateMarkdown: (title: string, content: string) => void;
  generateTXT: (title: string, content: string) => void;
}

export function useDocumentGenerator(): UseDocumentGeneratorReturn {
  const [isGenerating, setIsGenerating] = useState(false);

  const generatePPTX = useCallback(async (
    title: string, 
    slides: Array<{ title: string; content: string[] }>
  ): Promise<void> => {
    setIsGenerating(true);
    
    try {
      const pptx = new PptxGenJS();
      
      // Configuration royale
      pptx.layout = 'LAYOUT_16x9';
      pptx.author = 'NEXUS ROYAL';
      pptx.company = 'Cour Impériale';
      pptx.subject = title;
      pptx.title = title;

      // Master slide royal
      pptx.defineSlideMaster({
        title: 'ROYAL_MASTER',
        background: { color: '1A1A2E' },
        objects: [
          {
            rect: { x: 0, y: 0, w: '100%', h: 0.15, fill: { color: 'FFD700' } }
          },
          {
            rect: { x: 0, y: '90%', w: '100%', h: 0.15, fill: { color: 'FFD700' } }
          }
        ]
      });

      // Slide de titre
      const titleSlide = pptx.addSlide();
      titleSlide.background = { color: '0D0D0D' };
      titleSlide.addText(title, {
        x: 1, y: '40%', w: '80%',
        fontSize: 44,
        color: 'FFD700',
        align: 'center',
        fontFace: 'Playfair Display'
      });
      titleSlide.addText('Présentation Royale', {
        x: 1, y: '55%', w: '80%',
        fontSize: 18,
        color: 'C0C0C0',
        align: 'center'
      });

      // Slides de contenu
      slides.forEach((slide, index) => {
        const pptSlide = pptx.addSlide({ masterName: 'ROYAL_MASTER' });
        
        pptSlide.addText(slide.title, {
          x: 0.5, y: 0.5, w: '90%',
          fontSize: 28,
          color: 'FFD700',
          fontFace: 'Playfair Display'
        });

        const bulletPoints = slide.content.map(c => ({ text: c, options: { fontSize: 16, color: 'F8F8FF' } }));
        pptSlide.addText(bulletPoints, {
          x: 0.5, y: 1.5, w: '90%', h: 5,
          bullet: true,
          lineSpacing: 30
        });

        // Numéro de slide
        pptSlide.addText(`${index + 1}`, {
          x: '90%', y: '92%',
          fontSize: 12,
          color: 'FFD700'
        });
      });

      // Slide finale
      const finalSlide = pptx.addSlide();
      finalSlide.background = { color: '0D0D0D' };
      finalSlide.addText('👑', {
        x: '45%', y: '35%',
        fontSize: 60
      });
      finalSlide.addText('NEXUS ROYAL', {
        x: 1, y: '55%', w: '80%',
        fontSize: 24,
        color: 'FFD700',
        align: 'center'
      });

      await pptx.writeFile({ fileName: `${title.replace(/\s+/g, '_')}_Royal.pptx` });
    } finally {
      setIsGenerating(false);
    }
  }, []);

  const generateMarkdown = useCallback((title: string, content: string): void => {
    const markdownContent = `# ${title}

*Généré par NEXUS ROYAL - La Couronne de l'Intelligence Artificielle*

---

${content}

---

🏰 **NEXUS ROYAL** - *L'IA ne remplace pas l'homme, elle le couronne.*
`;
    const blob = new Blob([markdownContent], { type: 'text/markdown;charset=utf-8' });
    saveAs(blob, `${title.replace(/\s+/g, '_')}.md`);
  }, []);

  const generateTXT = useCallback((title: string, content: string): void => {
    const txtContent = `${title.toUpperCase()}
${'='.repeat(title.length)}

Généré par NEXUS ROYAL - La Couronne de l'Intelligence Artificielle

${content}

---
NEXUS ROYAL - L'IA ne remplace pas l'homme, elle le couronne.
`;
    const blob = new Blob([txtContent], { type: 'text/plain;charset=utf-8' });
    saveAs(blob, `${title.replace(/\s+/g, '_')}.txt`);
  }, []);

  const generateDocument = useCallback(async (
    type: DocumentType, 
    title: string, 
    content: string
  ): Promise<void> => {
    switch (type) {
      case 'pptx':
        // Pour PPTX, le contenu doit être parsé comme des slides
        const slides = parseContentToSlides(content);
        await generatePPTX(title, slides);
        break;
      case 'md':
        generateMarkdown(title, content);
        break;
      case 'txt':
        generateTXT(title, content);
        break;
      default:
        throw new Error(`Type de document ${type} non encore implémenté`);
    }
  }, [generatePPTX, generateMarkdown, generateTXT]);

  // Parser le contenu en slides
  const parseContentToSlides = (content: string): Array<{ title: string; content: string[] }> => {
    const slides: Array<{ title: string; content: string[] }> = [];
    const sections = content.split(/\n#{2,3}\s+/).filter(Boolean);
    
    sections.forEach(section => {
      const lines = section.split('\n').filter(l => l.trim());
      if (lines.length > 0) {
        const title = lines[0].replace(/^#+\s*/, '').trim();
        const bulletPoints = lines.slice(1)
          .map(l => l.replace(/^[-*•]\s*/, '').trim())
          .filter(l => l.length > 0);
        
        slides.push({
          title: title || 'Slide',
          content: bulletPoints.length > 0 ? bulletPoints : ['Contenu à développer']
        });
      }
    });

    return slides.length > 0 ? slides : [{ title: 'Contenu', content: [content.substring(0, 200)] }];
  };

  return {
    isGenerating,
    generateDocument,
    generatePPTX,
    generateMarkdown,
    generateTXT
  };
}
