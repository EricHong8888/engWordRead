class WordCardApp {
    constructor() {
        // 直接初始化应用
        this.currentUnit = 1;
        this.currentCardIndex = 0;
        this.cards = [];
        this.cardsWrapper = document.querySelector('.cards-wrapper');
        this.touchStartX = 0;
        this.currentTranslate = 0;
        this.currentlyPlaying = false;
        this.currentTimeout = null;

        // 初始化语音合成
        this.initializeSpeech().then(() => {
            this.initializeEventListeners();
            this.loadWords();
        });
    }

    async initializeSpeech() {
        try {
            if (!window.speechSynthesis) {
                throw new Error('浏览器不支持语音合成');
            }

            this.synth = window.speechSynthesis;
            await this.loadVoices();
            
            console.log('Speech synthesis initialized with voice:', this.englishVoice?.name);
        } catch (error) {
            console.error('Speech initialization error:', error);
            this.showError('语音功能初始化失败，请使用 Chrome 或 Edge 浏览器访问');
        }
    }

    showError(message) {
        if (this.cardsWrapper) {
            this.cardsWrapper.innerHTML = `
                <div class="word-card">
                    <div class="error-message">${message}</div>
                </div>
            `;
        }
    }

    async loadVoices() {
        return new Promise((resolve) => {
            const voices = this.synth.getVoices();
            
            if (voices.length > 0) {
                this.setVoice(voices);
                resolve();
            } else {
                // 等待voices加载完成
                this.synth.onvoiceschanged = () => {
                    const voices = this.synth.getVoices();
                    this.setVoice(voices);
                    resolve();
                };

                // 设置超时，防止无限等待
                setTimeout(() => {
                    if (!this.englishVoice) {
                        console.warn('Voice loading timeout, using default voice');
                        this.setVoice(this.synth.getVoices());
                        resolve();
                    }
                }, 3000);
            }
        });
    }

    setVoice(voices) {
        // 优先使用英语声音
        this.englishVoice = voices.find(voice => 
            voice.name.toLowerCase().includes('female') ||
            voice.name.toLowerCase().includes('Woman') ||
            voice.name.toLowerCase().includes('com.apple.ttsbundle.Karen-compact') ||
            voice.lang.includes('en-US') || voice.lang.includes('en-GB')
        ) || voices[0];
        // 测试语音是否可用
        this.testVoice();
    }

    async testVoice() {
        try {
            const utterance = new SpeechSynthesisUtterance('test');
            utterance.volume = 0; // 静音测试
            utterance.voice = this.englishVoice;
            
            // 测试语音
            this.synth.speak(utterance);
            
            // 取消测试语音
            setTimeout(() => {
                this.synth.cancel();
            }, 100);
        } catch (error) {
            console.error('Voice test failed:', error);
        }
    }

    async loadWords() {
        try {
            const response = await fetch('./engword.xlsx');
            const arrayBuffer = await response.arrayBuffer();
            const data = new Uint8Array(arrayBuffer);
            const workbook = XLSX.read(data, { type: 'array' });
            
            // 获取当前单元的sheet
            const sheetName = `unit${this.currentUnit}`;
            const worksheet = workbook.Sheets[sheetName];
            
            // 转换为JSON数据
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
            
            // 处理数据
            this.processExcelData(jsonData);
        } catch (error) {
            console.error('Error loading words:', error);
            this.showError('无法加载单词数据，请检查网络连接或刷新页面重试');
        }
    }

    processExcelData(jsonData) {
        try {
            // 移除标题行
            const dataRows = jsonData.slice(1);
            
            // 处理所有行
            this.cards = dataRows
                .filter(row => {
                    // 确保行数据完整且每个字段都不为空
                    return row && 
                           Array.isArray(row) && 
                           row.length >= 6 && 
                           row[0] && // 单词
                           row[1] && // 中文
                           row[2] && // 音标
                           row[3] && // 切词
                           row[4];   // 发音方式
                })
                .map(row => {
                    // 处理发音方式的换行
                    const pronunciation = String(row[4] || '')
                        .trim()
                        .split('/')
                        .filter(Boolean)
                        .map(part => part.trim())
                        .join('\n');  // 使用换行符分隔

                    return {
                        word: String(row[0] || '').trim(),
                        chinese: String(row[1] || '').trim(),
                        phonetic: String(row[2] || '').trim(),
                        segments: String(row[3] || '').trim(),
                        pronunciation: pronunciation,
                        isMustLearn: row[5] === '是'
                    };
                });

            if (this.cards.length === 0) {
                throw new Error(`Unit ${this.currentUnit} 没有找到有效的单词数据`);
            }

            console.log(`Processed ${this.cards.length} cards for Unit ${this.currentUnit}:`, this.cards);
            this.renderCards();
        } catch (error) {
            console.error('Error processing Excel data:', error);
            this.showError(`处理 Unit ${this.currentUnit} 单词数据时出错: ${error.message}`);
        }
    }

    renderCards() {
        this.cardsWrapper.innerHTML = '';
        this.cards.forEach((card, index) => {
            const cardElement = this.createCardElement(card, index);
            this.cardsWrapper.appendChild(cardElement);
        });
        this.updateCardPosition();
    }

    createCardElement(card, index) {
        const div = document.createElement('div');
        div.className = 'word-card';
        
        const segments = card.segments.split(' - ').map(s => s.trim()).filter(Boolean);
        
        div.innerHTML = `
            <div class="word ${card.isMustLearn ? 'must-learn' : ''}">${card.word}</div>
            <div class="chinese">${card.chinese}</div>
            <div class="phonetic">${card.phonetic}</div>
            <div class="segments">
                ${segments.map(segment => 
                    `<span class="segment">${segment}</span>`
                ).join('')}
            </div>
            <div class="pronunciation-label">发音方式：</div>
            <div class="pronunciation">${card.pronunciation}</div>
            <button class="read-button">拼读</button>
            <div class="card-index">第 ${index + 1} 个 / 共 ${this.cards.length} 个</div>
        `;

        const readButton = div.querySelector('.read-button');
        readButton.addEventListener('click', () => this.playWordAudio(card));

        return div;
    }

    playWordAudio(card) {
        // 确保语音功能已初始化
        if (!this.synth || !this.englishVoice) {
            console.warn('Speech synthesis not ready, reinitializing...');
            this.initializeSpeech().then(() => {
                this.playWordAudio(card);
            });
            return;
        }

        // 获取当前点击的卡片和按钮
        const currentCard = document.querySelector('.word-card:nth-child(' + (this.currentCardIndex + 1) + ')');
        const readButton = currentCard.querySelector('.read-button');
        
        // 如果当前正在播放，先停止
        if (this.currentlyPlaying) {
            this.stopReading();
            this.resetState(currentCard.querySelectorAll('.segment'), readButton);
            return;
        }

        // 设置当前正在播放状态
        this.currentlyPlaying = true;
        this.updateButtonState(readButton, true);

        // 设置安全定时器，确保按钮状态最终会恢复
        const MAX_PLAY_DURATION = 20000; // 改为 20 秒
        this.safetyTimer = setTimeout(() => {
            if (this.currentlyPlaying) {
                console.log('Safety timeout triggered - resetting state');
                this.stopReading();
                this.resetState(currentCard.querySelectorAll('.segment'), readButton);
            }
        }, MAX_PLAY_DURATION);

        // 获取切词数组并开始朗读
        const segments = card.segments.split(' - ').map(s => s.trim()).filter(Boolean);
        this.readSegments(segments, currentCard, readButton);
    }

    async readSegments(segments, currentCard, readButton) {
        const segmentElements = currentCard.querySelectorAll('.segment');
        const SEGMENT_DURATION = 1200; // 每个音节的持续时间
        const PAUSE_DURATION = 600;    // 音节之间的停顿时间

        try {
            // 清除所有高亮
            this.clearHighlights(segmentElements);

            // 朗读完整单词
            await this.speakText(segments.join(''));
            if (!this.currentlyPlaying) {
                this.resetState(segmentElements, readButton);
                return;
            }
            await this.delay(PAUSE_DURATION);

            // 朗读各个音节
            for (let i = 0; i < segments.length; i++) {
                if (!this.currentlyPlaying) {
                    this.resetState(segmentElements, readButton);
                    return;
                }

                // 高亮当前音节
                this.clearHighlights(segmentElements);
                segmentElements[i].classList.add('active');

                // 朗读当前音节
                await this.speakText(segments[i]);
                if (!this.currentlyPlaying) {
                    this.resetState(segmentElements, readButton);
                    return;
                }

                // 保持高亮一段时间
                await this.delay(SEGMENT_DURATION);
            }

            // 最后再读一遍完整单词
            if (!this.currentlyPlaying) {
                this.resetState(segmentElements, readButton);
                return;
            }
            this.clearHighlights(segmentElements);
            await this.delay(PAUSE_DURATION);
            await this.speakText(segments.join(''));

        } catch (error) {
            console.error('Reading error:', error);
        } finally {
            // 清除安全定时器
            if (this.safetyTimer) {
                clearTimeout(this.safetyTimer);
                this.safetyTimer = null;
            }
            
            // 确保在结束时重置状态
            this.currentlyPlaying = false;
            this.resetState(segmentElements, readButton);
        }
    }

    clearHighlights(elements) {
        elements.forEach(el => el.classList.remove('active'));
    }

    speakText(text) {
        return new Promise((resolve, reject) => {
            if (!this.currentlyPlaying) {
                resolve();
                return;
            }

            try {
                const utterance = new SpeechSynthesisUtterance(text);
                utterance.voice = this.englishVoice;
                utterance.rate = 0.8;  // 降低语速以匹配高亮显示
                utterance.pitch = 1;

                utterance.onend = () => resolve();
                utterance.onerror = (error) => reject(error);

                this.synth.speak(utterance);
            } catch (error) {
                reject(error);
            }
        });
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    stopReading() {
        // 清除安全定时器
        if (this.safetyTimer) {
            clearTimeout(this.safetyTimer);
            this.safetyTimer = null;
        }
        
        // 先取消语音
        if (this.synth && this.synth.speaking) {
            this.synth.cancel();
        }
        this.currentlyPlaying = false;
    }

    updateButtonState(button, isReading) {
        if (button) {
            const duration = '0.3s';
            button.style.transition = `opacity ${duration} ease`;
            
            if (isReading) {
                button.disabled = true;
                button.style.opacity = '0.6';
                button.textContent = '朗读中...';
            } else {
                button.disabled = false;
                button.style.opacity = '1';
                button.textContent = '拼读';
            }
        }
    }

    updateCardPosition() {
        // 计算每张卡片的宽度（包括右边距）
        const cardWidth = document.querySelector('.word-card').offsetWidth;
        const cardMargin = parseInt(window.getComputedStyle(document.querySelector('.word-card')).marginRight);
        const totalCardWidth = cardWidth + cardMargin;

        // 计算偏移量，使当前卡片居中但略微偏左以显示下一张卡片
        const offset = -(this.currentCardIndex * totalCardWidth);
        
        // 应用变换
        this.cardsWrapper.style.transform = `translateX(${offset}px)`;
    }

    initializeEventListeners() {
        // 导航切换
        document.querySelectorAll('.top-nav a').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                document.querySelector('.top-nav a.active').classList.remove('active');
                e.target.classList.add('active');
                this.currentUnit = parseInt(e.target.dataset.unit);
                this.currentCardIndex = 0;
                // 重新加载单词
                this.loadWords();
            });
        });

        // 触摸事件
        let touchStartX = 0;
        let touchStartY = 0;

        this.cardsWrapper.addEventListener('touchstart', (e) => {
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
        });

        this.cardsWrapper.addEventListener('touchmove', (e) => {
            const currentX = e.touches[0].clientX;
            const currentY = e.touches[0].clientY;
            const diffX = touchStartX - currentX;
            const diffY = touchStartY - currentY;

            // 只有水平滑动距离大于垂直滑动距离时才处理
            if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 50) {
                // 切换卡片时停止当前朗读
                this.stopReading();
                
                if (diffX > 0 && this.currentCardIndex < this.cards.length - 1) {
                    this.currentCardIndex++;
                } else if (diffX < 0 && this.currentCardIndex > 0) {
                    this.currentCardIndex--;
                }
                this.updateCardPosition();
                touchStartX = currentX;
            }
        });

        // 阻止默认的触摸行为
        document.body.addEventListener('touchmove', (e) => {
            e.preventDefault();
        }, { passive: false });
    }

    // 添加新的重置状态方法
    resetState(segmentElements, readButton) {
        this.clearHighlights(segmentElements);
        this.updateButtonState(readButton, false);
    }
}

// 等待 DOM 加载完成后初始化应用
document.addEventListener('DOMContentLoaded', () => {
    new WordCardApp();
}); 
